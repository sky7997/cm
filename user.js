const express = require('express')
const router = express.Router()
const User = require('../models/User.js')
const Transaction = require('../models/Transaction.js')
const Astrologer = require('../models/Astrologer.js')
const WalletTransactions = require('../models/WalletTransactions.js')
const ExotelCallback = require('../models/ExotelCallback.js')
const Queues = require('../models/Queue.js')
const moment = require('moment')
const momentTime = require('moment-timezone')
const logger = require('../Logger.js')
const { sendNotification } = require('../utils/firebase.js')
const Chatroom = require('../models/Chatroom.js')
const Coupon = require('../models/Coupons');

router.get("/updated-times", async (req, res) => {
  try {
    // Optionally add pagination or filters if needed
    const users = await User.find({}, { userName: 1, updatedAt: 1 })
      .sort({ updatedAt: -1 }) // sort by updatedAt desc
      .lean();

    // Format updatedAt to ISO string or other format here:
    const formattedUsers = users.map(u => ({
      userName: u.userName,
      updatedAt: u.updatedAt ? u.updatedAt.toISOString() : null,
    }));

    res.status(200).json({ users: formattedUsers });
  } catch (err) {
    console.error("Error fetching updated times:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});



// router.get("/get-users", async (req, res) => {
//     try {
//         const users = await User.find({});

//         if (!users || users.length === 0) {
//             return res.status(404).json({
//                 success: false,
//                 status: 404,
//                 message: "No users found",
//             });
//         }

//         const usersWithTotalAmount = await Promise.all(users.map(async (user) => {

//             const transactions = await Transaction.find({ user: user._id });
//             const totalAmount = transactions.reduce((sum, transaction) => sum + (transaction.amount || 0), 0);

//             return {
//                 ...user._doc,
//                 totalPayment: totalAmount
//             };
//         }));

//         return res.status(200).json({
//             success: true,
//             message: "Users fetched successfully",
//             data: usersWithTotalAmount,
//         });
//     } catch (error) {
//         return res.status(500).json({
//             success: false,
//             status: 500,
//             message: "Error while fetching users",
//             error: error.message,
//         });
//     }
// });
router.get('/get-users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1 //req.query default expressjs parameter to take values from fetch
    const limit = 10
    const skip = (page - 1) * limit

    let query = {}
    let todayInstalledCount
    if (req.query.date) {
      const selectedDate = moment(req.query.date)
      if (selectedDate.isAfter(moment(), 'day')) {
        todayInstalledCount = 0
      } else {
        const startOfDay = selectedDate.startOf('day').toDate()
        const endOfDay = selectedDate.endOf('day').toDate()
        query.createdAt = { $gte: startOfDay, $lte: endOfDay }

        todayInstalledCount = await User.countDocuments({
          createdAt: { $gte: startOfDay, $lte: endOfDay },
        })
      }
    } else { //here in else, if no date then selecting default(present date)
      const selectedDate = moment()
      const startOfDay = selectedDate.startOf('day').toDate()
      const endOfDay = selectedDate.endOf('day').toDate()
      todayInstalledCount = await User.countDocuments({
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      })
    }

    const users = await User.find(query) //fetches all users here bacause in frntend no date mentioned
      .sort({ updatedAt: -1 }) //descending order
      .skip(skip)
      .limit(limit)

    if (!users || users.length === 0) {
      logger.info('No user found')
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No users found',
        todayInstalled: todayInstalledCount,
      })
    }

    const usersWithWalletAndPayment = await Promise.all(
      users.map(async (user) => {
        const [transactions, claimedCoupons] = await Promise.all([
          Transaction.find({ user: user._id }),
          Coupon.find({ user: user._id, status: "claimed" }),
        ]);
    
        const totalAmount = transactions.reduce(
          (sum, transaction) => sum + (transaction.amount || 0),
          0
        );
    
        const couponCount = claimedCoupons.length;
        const couponSavings = claimedCoupons.reduce(
          (sum, coupon) => sum + parseFloat(coupon.amount || 0),
          0
        );
    
        return {
          ...user._doc,
          totalPayment: totalAmount,
          wallet: user.wallet || 0,
          couponsUsed: couponCount,
          couponSavings: couponSavings,
        };
      })
    );
    
    usersWithWalletAndPayment.sort((a, b) => b.wallet - a.wallet)
    const totalUsers = await User.countDocuments(query)
    const totalUserShowingAll = await User.countDocuments()

    return res.status(200).json({
      success: true,
      message: 'Users fetched successfully',
      data: usersWithWalletAndPayment,
      todayInstalled: todayInstalledCount,
      totalUserShowingAll: totalUserShowingAll,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalUsers / limit),
        totalUsers: totalUsers,
      },
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Error while fetching users',
      error: error.message,
    })
  }
})

router.get('/search-users', async (req, res) => {
  logger.info('Search users api is execute')
  try {
    const searchTerm = req.query.query
    const page = parseInt(req.query.page) || 1
    const limit = 10
    const skip = (page - 1) * limit

    if (!searchTerm) {
      logger.info('Search term is required')
      return res.status(400).json({
        success: false,
        message: 'Search term is required',
      })
    }

    const users = await User.find({
      $or: [
        { userName: { $regex: searchTerm, $options: 'i' } },
        { phone_number: { $regex: searchTerm, $options: 'i' } },
      ],
    })
      .skip(skip)
      .limit(limit)

    if (!users || users.length === 0) {
      logger.info('No users found for the search term')
      return res.status(404).json({
        success: false,
        message: 'No users found for the search term',
      })
    }

    const usersWithTotalAmount = await Promise.all(
      users.map(async (user) => {
        const transactions = await Transaction.find({ user: user._id })
        const totalAmount = transactions.reduce(
          (sum, transaction) => sum + (transaction.amount || 0),
          0
        )

        return {
          ...user._doc,
          totalPayment: totalAmount,
        }
      })
    )

    const totalUsers = await User.countDocuments({
      $or: [
        { userName: { $regex: searchTerm, $options: 'i' } },
        { phone_number: { $regex: searchTerm, $options: 'i' } },
      ],
    })
    logger.info('Search results fetched successfully')
    return res.status(200).json({
      success: true,
      message: 'Search results fetched successfully',
      data: usersWithTotalAmount,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalUsers / limit),
        totalUsers: totalUsers,
      },
    })
  } catch (error) {
    logger.error('Error while searching users', error)
    return res.status(500).json({
      success: false,
      message: 'Error while searching users',
      error: error.message,
    })
  }
})
router.get('/get-user/:userId', async (req, res) => {
  logger.info('get user by userId api')
  try {
    const { userId } = req.params
    const userData = await User.findById(userId)
    // const allUserIsactive = await User.updateMany({}, { isActive: true });
    console.log('line 221', userData)
    if (!userData) {
      logger.info('user not found')
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      })
    }
    logger.info('success user data')
    return res.status(200).json({
      success: true,
      user: userData,
    })
  } catch (error) {
    logger.error('Error getting the User details', error?.message ?? '')
    return res.status(500).json({
      success: false,
      message: 'Error getting the User details',
    })
  }
})

router.get('/get-all-exotel-callbacks', async (req, res) => {
  logger.info('get-all-exotel-callbacks api is start')
  try {
    const exotelCallbacks = await ExotelCallback.find({ type: 'call' })
      .populate('user', 'userName')
      .populate('astrologer', 'astrologerName')

    const callbackDetails = exotelCallbacks.map((callback) => {
      return {
        userName: callback.user ? callback.user.userName : 'Unknown',
        astrologerName: callback.astrologer
          ? callback.astrologer.astrologerName
          : 'Unknown',
        from: callback.from || 'Unknown',
        to: callback.to || 'Unknown',
        status: callback.status || 'N/A',
        date: callback.date || 'N/A',
        callCost: callback?.callCost || 'NA',
        recordingUrl: callback.recordingUrl || 'N/A',
      }
    })
    logger.info('success')
    return res.status(200).json({
      success: true,
      callbackHistory: callbackDetails,
    })
  } catch (error) {
    logger.error('Error fetching Exotel callback history', error)
    return res.status(500).json({
      message: 'Error fetching Exotel callback history',
      error: error.message,
    })
  }
})

router.get('/get-all-exotel-chatbacks', async (req, res) => {
  logger.info('/get-all-exotel-chatbacks api is execute')
  try {
    const exotelCallbacks = await ExotelCallback.find({ type: 'chat' })
      .populate('user', 'userName')
      .populate('astrologer', 'astrologerName')
      .sort({ updatedAt: -1 })

    const callbackDetails = await Promise.all(
      exotelCallbacks.map(async (callback) => {
        const astrologer = await Astrologer.findOne({
          phoneNumber: callback.to,
        })
        // eslint-disable-next-line no-unused-vars
        const astrologerCost = astrologer ? astrologer.cost : '0'
        //logger.info(exotelCallbacks)
        return {
          userName: callback.user ? callback.user.userName : 'Unknown',
          astrologerName: callback.astrologer
            ? callback.astrologer.astrologerName
            : 'Unknown',
          from: callback.from || 'Unknown',
          to: callback.to || 'Unknown',
          status: callback.status || 'N/A',
          callCost: callback?.callCost || '0',
          date: callback?.date || 'N/A',
        }
      })
    )
    logger.info('success')
    return res.status(200).json({
      success: true,
      callbackHistory: callbackDetails,
    })
  } catch (error) {
    logger.error('Error fetching Exotel callback history', error)
    return res.status(500).json({
      message: 'Error fetching Exotel callback history',
      error: error.message,
    })
  }
})

// router.get('/get-failed-chats', async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1
//     const perPage = 10
//     const failedChats = await Queues.aggregate([
//       { $match: { status: 'expired', type: 'chat' } },

//       { $sort: { updatedAt: -1 } },

//       { $skip: (page - 1) * perPage },
//       { $limit: perPage },

//       {
//         $lookup: {
//           from: 'astrologers',
//           localField: 'astrologerId',
//           foreignField: '_id',
//           as: 'astrologerDetails',
//         },
//       },

//       {
//         $project: {
//           _id: 1,
//           userId: 1,
//           userName: 1,
//           from: 1,
//           to: 1,
//           type: 1,
//           date: 1,
//           time: 1,
//           time_duration: 1,
//           channelRoomId: 1,
//           gender: 1,
//           place_of_birth: 1,
//           dob: 1,
//           cost: 1,
//           status: 1,
//           createdAt: 1,
//           updatedAt: 1,
//           astrologer: {
//             _id: { $arrayElemAt: ['$astrologerDetails._id', 0] },
//             astrologerName: {
//               $arrayElemAt: ['$astrologerDetails.astrologerName', 0],
//             },
//             phone_number: {
//               $arrayElemAt: ['$astrologerDetails.phone_number', 0],
//             },
//             status: {
//               $arrayElemAt: ['$astrologerDetails.status', 0],
//             },
//             category: {
//               $arrayElemAt: ['$astrologerDetails.category', 0],
//             },
//             known_languages: {
//               $arrayElemAt: ['$astrologerDetails.known_languages', 0],
//             },
//             expertIn: {
//               $arrayElemAt: ['$astrologerDetails.expertIn', 0],
//             },
//             experience: {
//               $arrayElemAt: ['$astrologerDetails.experience', 0],
//             },
//             order_bookings: {
//               $arrayElemAt: ['$astrologerDetails.order_bookings', 0],
//             },
//             cost: { $arrayElemAt: ['$astrologerDetails.cost', 0] },
//             profile_photo: {
//               $arrayElemAt: ['$astrologerDetails.profile_photo', 0],
//             },
//             wallet: {
//               $arrayElemAt: ['$astrologerDetails.wallet', 0],
//             },
//             createdAt: {
//               $arrayElemAt: ['$astrologerDetails.createdAt', 0],
//             },
//           },
//         },
//       },
//     ])

//     const formattedChats = failedChats.map((chat) => ({
//       ...chat,
//       updatedAt: momentTime(chat.updatedAt)
//         .tz('Asia/Kolkata')
//         .format('DD/MM/YYYY, hh:mm A'),
//     }))

//     const totalChats = await Queues.countDocuments({
//       status: 'expired',
//       type: 'chat',
//     })

//     return res.status(200).json({
//       success: true,
//       failedChatsList: formattedChats,
//       total: totalChats,
//       currentPage: page,
//       totalPages: Math.ceil(totalChats / perPage),
//     })
//   } catch (error) {
//     return res.status(500).json({
//       message: 'Error fetching Failed chats',
//       error: error.message,
//     })
//   }
// })
router.get('/get-failed-chats', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const perPage = 10
    const failedChats = await Queues.aggregate([
      { $match: { status: 'expired', type: 'chat' } },
      { $sort: { updatedAt: -1 } },
      { $skip: (page - 1) * perPage },
      { $limit: perPage },
      {
        $lookup: {
          from: 'astrologers',
          localField: 'astrologerId',
          foreignField: '_id',
          as: 'astrologerDetails',
        },
      },
      {
        $project: {
          _id: 1,
          userId: 1,
          userName: 1,
          from: 1,
          to: 1,
          type: 1,
          date: 1,
          time: 1,
          waitingTime: 1,
          channelRoomId: 1,
          gender: 1,
          place_of_birth: 1,
          dob: 1,
          cost: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          astrologer: {
            _id: { $arrayElemAt: ['$astrologerDetails._id', 0] },
            astrologerName: {
              $arrayElemAt: ['$astrologerDetails.astrologerName', 0],
            },
            phone_number: {
              $arrayElemAt: ['$astrologerDetails.phone_number', 0],
            },
            status: { $arrayElemAt: ['$astrologerDetails.status', 0] },
            category: { $arrayElemAt: ['$astrologerDetails.category', 0] },
            known_languages: {
              $arrayElemAt: ['$astrologerDetails.known_languages', 0],
            },
            expertIn: { $arrayElemAt: ['$astrologerDetails.expertIn', 0] },
            experience: { $arrayElemAt: ['$astrologerDetails.experience', 0] },
            order_bookings: {
              $arrayElemAt: ['$astrologerDetails.order_bookings', 0],
            },
            cost: { $arrayElemAt: ['$astrologerDetails.cost', 0] },
            profile_photo: {
              $arrayElemAt: ['$astrologerDetails.profile_photo', 0],
            },
            wallet: { $arrayElemAt: ['$astrologerDetails.wallet', 0] },
            createdAt: { $arrayElemAt: ['$astrologerDetails.createdAt', 0] },
            currentTabVersion: {
              $arrayElemAt: ['$astrologerDetails.currentTabVersion', 0],
            },
            upi: { $arrayElemAt: ['$astrologerDetails.upi', 0] },
          },
        },
      },
    ])

    const formattedChats = failedChats.map((chat) => {
      // Calculate duration between waitingTime and updatedAt
      let timeDurationFormatted = '0min'

      if (chat.waitingTime && chat.updatedAt) {
        const waitingTime = new Date(chat.waitingTime)
        const updatedAt = new Date(chat.updatedAt)

        if (!isNaN(waitingTime.getTime()) && !isNaN(updatedAt.getTime())) {
          const diffMs = updatedAt - waitingTime
          let totalMinutes = Math.floor(diffMs / (1000 * 60))

          // Calculate years, months, days, hours, minutes
          const years = Math.floor(totalMinutes / (365 * 24 * 60))
          totalMinutes %= 365 * 24 * 60

          const months = Math.floor(totalMinutes / (30 * 24 * 60))
          totalMinutes %= 30 * 24 * 60

          const days = Math.floor(totalMinutes / (24 * 60))
          totalMinutes %= 24 * 60

          const hours = Math.floor(totalMinutes / 60)
          const minutes = totalMinutes % 60

          // Build formatted string only with non-zero values
          const parts = []
          if (years > 0) parts.push(`${years}y`)
          if (months > 0) parts.push(`${months}m`)
          if (days > 0) parts.push(`${days}d`)
          if (hours > 0) parts.push(`${hours}h`)
          if (minutes > 0 || parts.length === 0) parts.push(`${minutes}min`) // Always show at least minutes

          timeDurationFormatted = parts.join('-')
        }
      }

      return {
        ...chat,
        time_duration: timeDurationFormatted,
        updatedAt: moment(chat.updatedAt)
          .tz('Asia/Kolkata')
          .format('DD/MM/YYYY, hh:mm A'),
        waitingTime: chat.waitingTime
          ? moment(chat.waitingTime)
              .tz('Asia/Kolkata')
              .format('DD/MM/YYYY, hh:mm A')
          : 'N/A',
      }
    })

    const totalChats = await Queues.countDocuments({
      status: 'expired',
      type: 'chat',
    })

    return res.status(200).json({
      success: true,
      failedChatsList: formattedChats,
      total: totalChats,
      currentPage: page,
      totalPages: Math.ceil(totalChats / perPage),
    })
  } catch (error) {
    console.error('Error fetching failed chats:', error)
    return res.status(500).json({
      message: 'Error fetching Failed chats',
      error: error.message,
    })
  }
})

//update code for expire
router.get('/get-failed-expired-chats-by-astrologer', async (req, res) => {
  try {
    const { astrologerId, page = 1 } = req.query
    const perPage = 10

    // Validate astrologerId
    if (!astrologerId || !mongoose.Types.ObjectId.isValid(astrologerId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid Astrologer ID is required',
      })
    }

    const astrologerObjectId = new mongoose.Types.ObjectId(astrologerId)

    // Aggregation pipeline with astrologer filter
    const failedChats = await Queues.aggregate([
      {
        $match: {
          status: 'expired',
          type: 'chat',
          astrologerId: astrologerObjectId, // Filter by specific astrologer
        },
      },
      { $sort: { updatedAt: -1 } },
      { $skip: (page - 1) * perPage },
      { $limit: perPage },
      {
        $lookup: {
          from: 'astrologers',
          localField: 'astrologerId',
          foreignField: '_id',
          as: 'astrologerDetails',
        },
      },
      {
        $project: {
          _id: 1,
          userId: 1,
          userName: 1,
          from: 1,
          to: 1,
          type: 1,
          date: 1,
          time: 1,
          time_duration: 1,
          channelRoomId: 1,
          gender: 1,
          place_of_birth: 1,
          dob: 1,
          cost: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          astrologer: {
            _id: { $arrayElemAt: ['$astrologerDetails._id', 0] },
            astrologerName: {
              $arrayElemAt: ['$astrologerDetails.astrologerName', 0],
            },
            phone_number: {
              $arrayElemAt: ['$astrologerDetails.phone_number', 0],
            },
            status: { $arrayElemAt: ['$astrologerDetails.status', 0] },
            category: { $arrayElemAt: ['$astrologerDetails.category', 0] },
            known_languages: {
              $arrayElemAt: ['$astrologerDetails.known_languages', 0],
            },
            expertIn: { $arrayElemAt: ['$astrologerDetails.expertIn', 0] },
            experience: { $arrayElemAt: ['$astrologerDetails.experience', 0] },
            order_bookings: {
              $arrayElemAt: ['$astrologerDetails.order_bookings', 0],
            },
            cost: { $arrayElemAt: ['$astrologerDetails.cost', 0] },
            profile_photo: {
              $arrayElemAt: ['$astrologerDetails.profile_photo', 0],
            },
            wallet: { $arrayElemAt: ['$astrologerDetails.wallet', 0] },
            createdAt: { $arrayElemAt: ['$astrologerDetails.createdAt', 0] },
          },
        },
      },
    ])

    // Format time duration and dates
    const formattedChats = failedChats.map((chat) => {
      // Convert time_duration from "hr:min" to "y-m-d-h-min" format
      let timeDurationFormatted = ''
      if (chat.time_duration) {
        const [hoursStr, minutesStr] = chat.time_duration.split(':')
        let totalMinutes =
          (parseInt(hoursStr) || 0) * 60 + (parseInt(minutesStr) || 0)

        const years = Math.floor(totalMinutes / (365 * 24 * 60))
        totalMinutes %= 365 * 24 * 60

        const months = Math.floor(totalMinutes / (30 * 24 * 60))
        totalMinutes %= 30 * 24 * 60

        const days = Math.floor(totalMinutes / (24 * 60))
        totalMinutes %= 24 * 60

        const hours = Math.floor(totalMinutes / 60)
        const minutes = totalMinutes % 60

        // BUild formatted string only with non-zero values
        const parts = []
        if (years > 0) parts.push(`${years}y`)
        if (months > 0) parts.push(`${months}m`)
        if (days > 0) parts.push(`${days}d`)
        if (hours > 0) parts.push(`${hours}h`)
        if (minutes > 0) parts.push(`${minutes}min`)

        //If all are zero, show "0min"
        timeDurationFormatted = parts.length > 0 ? parts.join('-') : '0min'
      } else {
        timeDurationFormatted = '0min'
      }

      return {
        ...chat,
        time_duration: timeDurationFormatted,
        updatedAt: momentTime(chat.updatedAt)
          .tz('Asia/Kolkata')
          .format('DD/MM/YYYY, hh:mm A'),
      }
    })

    // Get total count for pagination
    const totalChats = await Queues.countDocuments({
      status: 'expired',
      type: 'chat',
      astrologerId: astrologerObjectId, // Count only for this astrologer
    })

    return res.status(200).json({
      success: true,
      failedChatsList: formattedChats,
      total: totalChats,
      currentPage: Number(page),
      totalPages: Math.ceil(totalChats / perPage),
      astrologerDetails: failedChats[0]?.astrologer || null, // Include astrologer details
    })
  } catch (error) {
    console.error('Error fetching failed chats by astrologer:', error)
    return res.status(500).json({
      success: false,
      message: 'Error fetching failed chats',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    })
  }
})

//end update code

router.get('/search-failed-chats', async (req, res) => {
  logger.info('search-failed-chats api is start')
  try {
    const { search } = req.query
    const searchRegex = new RegExp(search, 'i')

    const failedChats = await Queues.aggregate([
      // Match for failed status (e.g., 'expired')
      {
        $match: {
          status: 'expired',
          type: 'chat', // Targeting failed chats with status 'expired'
        },
      },

      // Lookup for astrologer details
      {
        $lookup: {
          from: 'astrologers',
          localField: 'astrologerId',
          foreignField: '_id',
          as: 'astrologerDetails',
        },
      },

      // Lookup for user details
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'userDetails',
        },
      },

      // Apply search filter based on user or astrologer information
      {
        $match: {
          $or: [
            { 'userDetails.userName': searchRegex }, // Search by user's name
            { 'userDetails.phone_number': searchRegex }, // Search by user's phone number
            { 'astrologerDetails.astrologerName': searchRegex }, // Search by astrologer's name
            { 'astrologerDetails.phone_number': searchRegex }, // Search by astrologer's phone number
          ],
        },
      },

      // Sort by updatedAt in descending order
      {
        $sort: { updatedAt: -1 },
      },

      // Project the required fields and include astrologer details
      {
        $project: {
          _id: 1,
          userId: 1,
          userName: { $arrayElemAt: ['$userDetails.userName', 0] },
          userPhone: {
            $arrayElemAt: ['$userDetails.phone_number', 0],
          },
          from: 1,
          to: 1,
          type: 1,
          date: 1,
          time: 1,
          time_duration: 1,
          channelRoomId: 1,
          gender: 1,
          place_of_birth: 1,
          dob: 1,
          cost: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          astrologer: {
            _id: { $arrayElemAt: ['$astrologerDetails._id', 0] },
            astrologerName: {
              $arrayElemAt: ['$astrologerDetails.astrologerName', 0],
            },
            phone_number: {
              $arrayElemAt: ['$astrologerDetails.phone_number', 0],
            },
            status: {
              $arrayElemAt: ['$astrologerDetails.status', 0],
            },
            category: {
              $arrayElemAt: ['$astrologerDetails.category', 0],
            },
            known_languages: {
              $arrayElemAt: ['$astrologerDetails.known_languages', 0],
            },
            expertIn: {
              $arrayElemAt: ['$astrologerDetails.expertIn', 0],
            },
            experience: {
              $arrayElemAt: ['$astrologerDetails.experience', 0],
            },
            order_bookings: {
              $arrayElemAt: ['$astrologerDetails.order_bookings', 0],
            },
            cost: { $arrayElemAt: ['$astrologerDetails.cost', 0] },
            profile_photo: {
              $arrayElemAt: ['$astrologerDetails.profile_photo', 0],
            },
            isActive: {
              $arrayElemAt: ['$astrologerDetails.isActive', 0],
            },
          },
        },
      },
    ])

    // Format the response
    const responseChats = failedChats.map((chat) => ({
      _id: chat._id,
      userId: chat.userId,
      userName: chat.userName,
      userPhone: chat.userPhone,
      from: chat.from,
      to: chat.astrologer ? chat.astrologer.phone_number : null,
      type: chat.type,
      date: chat.date,
      time: chat.time,
      astrologerId: chat.astrologer ? chat.astrologer._id : null,
      astrologerName: chat.astrologer ? chat.astrologer.astrologerName : null,
      time_duration: chat.time_duration,
      channelRoomId: chat.channelRoomId,
      gender: chat.gender,
      place_of_birth: chat.place_of_birth,
      dob: chat.dob,
      cost: chat.cost,
      status: chat.status,
      createdAt: chat.createdAt,
      updatedAt: momentTime(chat.updatedAt)
        .tz('Asia/Kolkata')
        .format('MM/DD/YYYY, hh:mm A'),
      astrologer: chat.astrologer, // Include astrologer object in the response
    }))

    // Return the formatted response
    logger.info('success')
    return res.status(200).json({
      success: true,
      chats: responseChats,
    })
  } catch (error) {
    logger.error('Error searching failed chat details', error)
    return res.status(500).json({
      success: false,
      message: 'Error searching failed chat details',
    })
  }
})

//update code for search filter by expired
router.get('/search-failed-chats-expired-astrologer', async (req, res) => {
  logger.info('search-failed-chats api is start')
  try {
    const { search, astrologerId } = req.query
    const searchRegex = search ? new RegExp(search, 'i') : null

    // Base match filter for failed chats
    const baseMatch = {
      status: 'expired',
      type: 'chat',
    }

    // Add astrologerId filter if provided
    if (astrologerId) {
      baseMatch.astrologerId = new mongoose.Types.ObjectId(astrologerId)
    }

    const aggregationPipeline = [
      // Match for failed status and optional astrologerId
      { $match: baseMatch },

      // Lookup for astrologer details
      {
        $lookup: {
          from: 'astrologers',
          localField: 'astrologerId',
          foreignField: '_id',
          as: 'astrologerDetails',
        },
      },

      // Lookup for user details
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'userDetails',
        },
      },
    ]

    // Add search filter if search term is provided
    if (searchRegex) {
      aggregationPipeline.push({
        $match: {
          $or: [
            { 'userDetails.userName': searchRegex },
            { 'userDetails.phone_number': searchRegex },
            { 'astrologerDetails.astrologerName': searchRegex },
            { 'astrologerDetails.phone_number': searchRegex },
          ],
        },
      })
    }

    // Continue with the rest of the pipeline
    aggregationPipeline.push(
      // Sort by updatedAt in descending order
      { $sort: { updatedAt: -1 } },

      // Project the required fields
      {
        $project: {
          _id: 1,
          userId: 1,
          userName: { $arrayElemAt: ['$userDetails.userName', 0] },
          userPhone: { $arrayElemAt: ['$userDetails.phone_number', 0] },
          from: 1,
          to: 1,
          type: 1,
          date: 1,
          time: 1,
          time_duration: 1,
          channelRoomId: 1,
          gender: 1,
          place_of_birth: 1,
          dob: 1,
          cost: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          astrologer: {
            _id: { $arrayElemAt: ['$astrologerDetails._id', 0] },
            astrologerName: {
              $arrayElemAt: ['$astrologerDetails.astrologerName', 0],
            },
            phone_number: {
              $arrayElemAt: ['$astrologerDetails.phone_number', 0],
            },
            status: { $arrayElemAt: ['$astrologerDetails.status', 0] },
            category: { $arrayElemAt: ['$astrologerDetails.category', 0] },
            known_languages: {
              $arrayElemAt: ['$astrologerDetails.known_languages', 0],
            },
            expertIn: { $arrayElemAt: ['$astrologerDetails.expertIn', 0] },
            experience: { $arrayElemAt: ['$astrologerDetails.experience', 0] },
            order_bookings: {
              $arrayElemAt: ['$astrologerDetails.order_bookings', 0],
            },
            cost: { $arrayElemAt: ['$astrologerDetails.cost', 0] },
            profile_photo: {
              $arrayElemAt: ['$astrologerDetails.profile_photo', 0],
            },
            isActive: { $arrayElemAt: ['$astrologerDetails.isActive', 0] },
          },
        },
      }
    )

    const failedChats = await Queues.aggregate(aggregationPipeline)

    // Format the response - keeping original format but updating time formatting
    const responseChats = failedChats.map((chat) => {
      // Convert time_duration from "hr:min" to "y-m-d-h-min" format (from reference API)
      let timeDurationFormatted = ''
      if (chat.time_duration) {
        const [hoursStr, minutesStr] = chat.time_duration.split(':')
        let totalMinutes =
          (parseInt(hoursStr) || 0) * 60 + (parseInt(minutesStr) || 0)

        const years = Math.floor(totalMinutes / (365 * 24 * 60))
        totalMinutes %= 365 * 24 * 60

        const months = Math.floor(totalMinutes / (30 * 24 * 60))
        totalMinutes %= 30 * 24 * 60

        const days = Math.floor(totalMinutes / (24 * 60))
        totalMinutes %= 24 * 60

        const hours = Math.floor(totalMinutes / 60)
        const minutes = totalMinutes % 60

        const parts = []
        if (years > 0) parts.push(`${years}y`)
        if (months > 0) parts.push(`${months}m`)
        if (days > 0) parts.push(`${days}d`)
        if (hours > 0) parts.push(`${hours}h`)
        if (minutes > 0) parts.push(`${minutes}min`)

        timeDurationFormatted = parts.length > 0 ? parts.join('-') : '0min'
      } else {
        timeDurationFormatted = '0min'
      }

      return {
        _id: chat._id,
        userId: chat.userId,
        userName: chat.userName,
        userPhone: chat.userPhone,
        from: chat.from,
        to: chat.astrologer ? chat.astrologer.phone_number : null,
        type: chat.type,
        date: chat.date,
        time: chat.time,
        astrologerId: chat.astrologer ? chat.astrologer._id : null,
        astrologerName: chat.astrologer ? chat.astrologer.astrologerName : null,
        time_duration: timeDurationFormatted, // Updated time duration format
        channelRoomId: chat.channelRoomId,
        gender: chat.gender,
        place_of_birth: chat.place_of_birth,
        dob: chat.dob,
        cost: chat.cost,
        status: chat.status,
        createdAt: chat.createdAt,
        updatedAt: moment(chat.updatedAt)
          .tz('Asia/Kolkata')
          .format('MM/DD/YYYY, hh:mm A'), // Keeping original date format
        astrologer: chat.astrologer, // Keeping original astrologer object
      }
    })

    // Return the formatted response - keeping original response structure
    logger.info('success')
    return res.status(200).json({
      success: true,
      chats: responseChats, // Original field name
      filters: {
        // Keeping filters in response
        search: search || null,
        astrologerId: astrologerId || null,
      },
    })
  } catch (error) {
    logger.error('Error searching failed chat details', error)
    return res.status(500).json({
      success: false,
      message: 'Error searching failed chat details',
      error: error.message,
    })
  }
})

router.get('/get-completed-chats', async (req, res) => {
  logger.info('get completed chats API is executed')
  try {
    const page = parseInt(req.query.page) || 1
    const limit = 10
    const skip = (page - 1) * limit

    // Fetch completed chats but exclude free chats with session_time < 5
    const completedChats = await WalletTransactions.find({
      type: 'chat',
      wallet_type: 'production',
      $or: [
        {
          amount: { $ne: 'free chat' },
          $expr: { $gte: [{ $toInt: '$session_time' }, 4] },
        }, // Include paid chats
        {
          amount: 'free chat',
          $expr: { $gte: [{ $toInt: '$session_time' }, 4] },
        }, // Include free chats only if session_time >= 5
      ],
    })
      .populate('user', 'userId userName phone_number')
      .populate(
        'astrologer',
        'astrologerId astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt currentTabVersion upi'
      )
      .sort({ updatedAt: -1 })
      .limit(limit)
      .skip(skip)

    // Fetch total chats (excluding free chats and paid chats with session_time < 5)
    const totalChats = await WalletTransactions.find({
      type: 'chat',
      wallet_type: 'production',
      $or: [
        {
          amount: { $ne: 'free chat' },
          $expr: { $gte: [{ $toInt: '$session_time' }, 4] },
        },
        {
          amount: 'free chat',
          $expr: { $gte: [{ $toInt: '$session_time' }, 4] },
        },
      ],
    })

    const totalFreeChats = totalChats.filter(
      (chat) => chat.amount === 'free chat'
    ).length
    const totalPaidChats = totalChats.filter(
      (chat) => chat.amount !== 'free chat'
    ).length

    const totalAmount = totalChats
      .filter((chat) => chat.amount !== 'free chat')
      .reduce((sum, chat) => sum + Number(chat.amount), 0)

    const updatedChats = completedChats.map((chat) => {
      let chatCost
      // let session_time = parseInt(chat?.session_time || 0)
      if (chat.amount === 'free chat') {
        chatCost = 'Free'
      } else {
        chatCost = chat.amount
      }

      return {
        ...chat.toObject(),
        chatCost,
        chatEndFrom: chat?.chatEndFrom,
        createdAt: chat.createdAt
          ? chat.createdAt.toLocaleString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: true,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'NA',
        updatedAt: chat?.updatedAt
          ? chat.updatedAt.toLocaleString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: true,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'NA',
      }
    })

    const totalTransactions = await WalletTransactions.countDocuments()
    logger.info('success')
    return res.status(200).json({
      success: true,
      CompletedChats: updatedChats,
      currentPage: page,
      totalPages: Math.ceil(totalTransactions / limit),
      totalFreeChats: totalFreeChats,
      totalPaidChats: totalPaidChats,
      totalTransactions: totalTransactions,
      totalAmount: totalAmount,
    })
  } catch (error) {
    logger.error('Error fetching completed Chats', error)
    return res.status(500).json({
      message: 'Error fetching completed Chats',
      error: error.message,
    })
  }
})

//update code completed
router.get('/get-completed-chats-by-astrologer', async (req, res) => {
  logger.info('get completed chats by astrologer API is executing')
  try {
    const { astrologerId, page = 1 } = req.query
    const limit = 10
    const skip = (page - 1) * limit

    // Validate astrologerId
    if (!astrologerId || !mongoose.Types.ObjectId.isValid(astrologerId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid Astrologer ID is required',
      })
    }

    const astrologerObjectId = new mongoose.Types.ObjectId(astrologerId)

    // Base query with astrologer filter
    const baseQuery = {
      type: 'chat',
      wallet_type: 'production',
      astrologer: astrologerObjectId,
      $or: [
        {
          amount: { $ne: 'free chat' },
          $expr: { $gte: [{ $toInt: '$session_time' }, 5] },
        },
        {
          amount: 'free chat',
          $expr: { $gte: [{ $toInt: '$session_time' }, 5] },
        },
      ],
    }

    // Execute all queries in parallel for better performance
    const [completedChats, counts, paidChats] = await Promise.all([
      WalletTransactions.find(baseQuery)
        .populate('user', 'userId userName phone_number')
        .populate(
          'astrologer',
          'astrologerId astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt'
        )
        .sort({ updatedAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),

      WalletTransactions.aggregate([
        { $match: baseQuery },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            free: {
              $sum: { $cond: [{ $eq: ['$amount', 'free chat'] }, 1, 0] },
            },
            paid: {
              $sum: { $cond: [{ $ne: ['$amount', 'free chat'] }, 1, 0] },
            },
          },
        },
      ]),

      WalletTransactions.find({ ...baseQuery, amount: { $ne: 'free chat' } }),
    ])

    // Calculate total amount from paid chats
    const totalAmount = paidChats.reduce(
      (sum, chat) => sum + Number(chat.amount),
      0
    )

    // Format the response data
    const updatedChats = completedChats.map((chat) => {
      const chatCost = chat.amount === 'free chat' ? 'Free' : chat.amount

      // Format dates
      const formatDate = (date) => {
        if (!date) return 'NA'
        return new Date(date).toLocaleString('en-GB', {
          timeZone: 'Asia/Kolkata',
          hour12: true,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      }

      return {
        ...chat,
        chatCost,
        chatEndFrom: chat.chatEndFrom || null,
        createdAt: formatDate(chat.createdAt),
        updatedAt: formatDate(chat.updatedAt),
        // Ensure consistent structure
        user: {
          _id: chat.user?._id,
          userId: chat.user?.userId,
          userName: chat.user?.userName,
          phone_number: chat.user?.phone_number,
        },
        astrologer: {
          _id: chat.astrologer?._id,
          astrologerId: chat.astrologer?.astrologerId,
          astrologerName: chat.astrologer?.astrologerName,
          phone_number: chat.astrologer?.phone_number,
          profile_photo: chat.astrologer?.profile_photo || '',
          category: chat.astrologer?.category,
          known_languages: chat.astrologer?.known_languages || [],
          expertIn: chat.astrologer?.expertIn || [],
          experience: chat.astrologer?.experience || '0 years',
          cost: chat.astrologer?.cost || '0',
          order_bookings: chat.astrologer?.order_bookings || 0,
          status: chat.astrologer?.status || 'inactive',
          wallet: chat.astrologer?.wallet || 0,
          createdAt: chat.astrologer?.createdAt,
        },
      }
    })

    const countResult = counts[0] || { total: 0, free: 0, paid: 0 }

    logger.info('Successfully fetched completed chats for astrologer')
    return res.status(200).json({
      success: true,
      CompletedChats: updatedChats,
      currentPage: Number(page),
      totalPages: Math.ceil(countResult.total / limit),
      totalFreeChats: countResult.free,
      totalPaidChats: countResult.paid,
      totalTransactions: countResult.total,
      totalAmount,
      astrologerDetails: completedChats[0]?.astrologer || null,
    })
  } catch (error) {
    logger.error('Error fetching completed chats by astrologer:', error)
    return res.status(500).json({
      success: false,
      message: 'Error fetching completed chats',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    })
  }
})

router.get('/get-completedChats-by-date-astrologer', async (req, res) => {
  logger.info('get completed chats by date API is executing')
  try {
    const { date, astrologerId, page = 1 } = req.query
    const limit = 10
    const skip = (page - 1) * limit

    // Validate date
    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Date query parameter is required',
      })
    }

    // Convert selected date to start and end of the day in the Asia/Kolkata timezone
    const startOfDay = momentTime
      .tz(date, 'Asia/Kolkata')
      .startOf('day')
      .toDate()

    const endOfDay = momentTime.tz(date, 'Asia/Kolkata').endOf('day').toDate()

    // Base query with date filter
    const baseQuery = {
      type: 'chat',
      wallet_type: 'production',
      date: { $gte: startOfDay, $lte: endOfDay },
      $or: [
        {
          amount: { $ne: 'free chat' },
          $expr: { $gte: [{ $toInt: '$session_time' }, 5] },
        },
        {
          amount: 'free chat',
          $expr: { $gte: [{ $toInt: '$session_time' }, 5] },
        },
      ],
    }

    // Add astrologer filter if provided
    if (astrologerId && mongoose.Types.ObjectId.isValid(astrologerId)) {
      baseQuery.astrologer = new mongoose.Types.ObjectId(astrologerId)
    }

    // Execute all queries in parallel for better performance
    const [completedChats, counts, paidChats] = await Promise.all([
      WalletTransactions.find(baseQuery)
        .populate('user', 'userId userName phone_number')
        .populate(
          'astrologer',
          'astrologerId astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt'
        )
        .sort({ updatedAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),

      WalletTransactions.aggregate([
        { $match: baseQuery },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            free: {
              $sum: { $cond: [{ $eq: ['$amount', 'free chat'] }, 1, 0] },
            },
            paid: {
              $sum: { $cond: [{ $ne: ['$amount', 'free chat'] }, 1, 0] },
            },
          },
        },
      ]),

      WalletTransactions.find({ ...baseQuery, amount: { $ne: 'free chat' } }),
    ])

    // Calculate total amount from paid chats
    const totalAmount = paidChats.reduce(
      (sum, chat) => sum + Number(chat.amount),
      0
    )

    // Format the response data
    const updatedChats = completedChats.map((chat) => {
      const chatCost = chat.amount === 'free chat' ? 'Free' : chat.amount

      // Format dates
      const formatDate = (date) => {
        if (!date) return 'NA'
        return new Date(date).toLocaleString('en-GB', {
          timeZone: 'Asia/Kolkata',
          hour12: true,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      }

      return {
        ...chat,
        chatCost,
        chatEndFrom: chat.chatEndFrom || null,
        createdAt: formatDate(chat.createdAt),
        updatedAt: formatDate(chat.updatedAt),
        // Ensure consistent structure
        user: {
          _id: chat.user?._id,
          userId: chat.user?.userId,
          userName: chat.user?.userName,
          phone_number: chat.user?.phone_number,
        },
        astrologer: {
          _id: chat.astrologer?._id,
          astrologerId: chat.astrologer?.astrologerId,
          astrologerName: chat.astrologer?.astrologerName,
          phone_number: chat.astrologer?.phone_number,
          profile_photo: chat.astrologer?.profile_photo || '',
          category: chat.astrologer?.category,
          known_languages: chat.astrologer?.known_languages || [],
          expertIn: chat.astrologer?.expertIn || [],
          experience: chat.astrologer?.experience || '0 years',
          cost: chat.astrologer?.cost || '0',
          order_bookings: chat.astrologer?.order_bookings || 0,
          status: chat.astrologer?.status || 'inactive',
          wallet: chat.astrologer?.wallet || 0,
          createdAt: chat.astrologer?.createdAt,
        },
      }
    })

    const countResult = counts[0] || { total: 0, free: 0, paid: 0 }

    logger.info('Successfully fetched completed chats for date')
    return res.status(200).json({
      success: true,
      SelectedDate: date,
      CompletedChats: updatedChats,
      currentPage: Number(page),
      totalPages: Math.ceil(countResult.total / limit),
      totalFreeChats: countResult.free,
      totalPaidChats: countResult.paid,
      totalTransactions: countResult.total,
      totalAmount,
      astrologerDetails: astrologerId
        ? completedChats[0]?.astrologer || null
        : null,
    })
  } catch (error) {
    logger.error('Error fetching completed chats by date:', error)
    return res.status(500).json({
      success: false,
      message: 'Error fetching completed chats',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    })
  }
})

router.get('/get-completedChats-by-date-range-astrologer', async (req, res) => {
  logger.info('get completed chats by date range API is executing')
  try {
    const { from, to, astrologerId, page = 1 } = req.query
    const limit = 10
    const skip = (page - 1) * limit

    // Validate date range
    if (!from || !to) {
      return res.status(400).json({
        success: false,
        message: 'Both from and to query parameters are required',
      })
    }

    // Parse dates with validation
    const parsedFrom = momentTime(from, 'DD-MM-YYYY', true)
    const parsedTo = momentTime(to, 'DD-MM-YYYY', true)

    if (!parsedFrom.isValid() || !parsedTo.isValid()) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Please use DD-MM-YYYY format',
      })
    }

    const startOfDay = parsedFrom.tz('Asia/Kolkata').startOf('day').toDate()
    const endOfDay = parsedTo.tz('Asia/Kolkata').endOf('day').toDate()

    // Base query with date range filter
    const baseQuery = {
      type: 'chat',
      wallet_type: 'production',
      date: { $gte: startOfDay, $lte: endOfDay },
      $or: [
        {
          amount: { $ne: 'free chat' },
          $expr: { $gte: [{ $toInt: '$session_time' }, 5] },
        },
        {
          amount: 'free chat',
          $expr: { $gte: [{ $toInt: '$session_time' }, 5] },
        },
      ],
    }

    // Add astrologer filter if provided
    if (astrologerId && mongoose.Types.ObjectId.isValid(astrologerId)) {
      baseQuery.astrologer = new mongoose.Types.ObjectId(astrologerId)
    }

    // Execute all queries in parallel for better performance
    const [completedChats, counts, paidChats] = await Promise.all([
      WalletTransactions.find(baseQuery)
        .populate('user', 'userId userName phone_number')
        .populate(
          'astrologer',
          'astrologerId astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt'
        )
        .sort({ updatedAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),

      WalletTransactions.aggregate([
        { $match: baseQuery },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            free: {
              $sum: { $cond: [{ $eq: ['$amount', 'free chat'] }, 1, 0] },
            },
            paid: {
              $sum: { $cond: [{ $ne: ['$amount', 'free chat'] }, 1, 0] },
            },
          },
        },
      ]),

      WalletTransactions.find({ ...baseQuery, amount: { $ne: 'free chat' } }),
    ])

    // Calculate total amount from paid chats
    const totalAmount = paidChats.reduce((sum, chat) => {
      const cost = Number(chat.amount) / (chat.session_time || 1) // Prevent division by zero
      return sum + (isNaN(cost) ? 0 : cost)
    }, 0)

    // Format the response data
    const updatedChats = completedChats.map((chat) => {
      const chatCost =
        chat.amount === 'free chat'
          ? 'Free'
          : Number(chat.amount) / (chat.session_time || 1)

      // Format dates
      const formatDate = (date) => {
        if (!date) return 'NA'
        return new Date(date).toLocaleString('en-GB', {
          timeZone: 'Asia/Kolkata',
          hour12: true,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      }

      return {
        ...chat,
        chatCost,
        chatEndFrom: chat.chatEndFrom || null,
        createdAt: formatDate(chat.createdAt),
        updatedAt: formatDate(chat.updatedAt),
        // Ensure consistent structure
        user: {
          _id: chat.user?._id,
          userId: chat.user?.userId,
          userName: chat.user?.userName,
          phone_number: chat.user?.phone_number,
        },
        astrologer: {
          _id: chat.astrologer?._id,
          astrologerId: chat.astrologer?.astrologerId,
          astrologerName: chat.astrologer?.astrologerName,
          phone_number: chat.astrologer?.phone_number,
          profile_photo: chat.astrologer?.profile_photo || '',
          category: chat.astrologer?.category,
          known_languages: chat.astrologer?.known_languages || [],
          expertIn: chat.astrologer?.expertIn || [],
          experience: chat.astrologer?.experience || '0 years',
          cost: chat.astrologer?.cost || '0',
          order_bookings: chat.astrologer?.order_bookings || 0,
          status: chat.astrologer?.status || 'inactive',
          wallet: chat.astrologer?.wallet || 0,
          createdAt: chat.astrologer?.createdAt,
        },
      }
    })

    const countResult = counts[0] || { total: 0, free: 0, paid: 0 }

    logger.info('Successfully fetched completed chats for date range')
    return res.status(200).json({
      success: true,
      dateRange: { from, to },
      CompletedChats: updatedChats,
      currentPage: Number(page),
      totalPages: Math.ceil(countResult.total / limit),
      totalFreeChats: countResult.free,
      totalPaidChats: countResult.paid,
      totalTransactions: countResult.total,
      totalAmount,
      astrologerDetails: astrologerId
        ? completedChats[0]?.astrologer || null
        : null,
    })
  } catch (error) {
    logger.error('Error fetching completed chats by date range:', error)
    return res.status(500).json({
      success: false,
      message: 'Error fetching completed chats',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    })
  }
})

router.get('/search-completed-chats', async (req, res) => {
  logger.info('search-completed-chats API executed')
  try {
    const search = req.query.search || ''
    const page = parseInt(req.query.page) || 1
    const limit = 50
    const skip = (page - 1) * limit

    const userIds = await User.find(
      {
        $or: [
          { userName: { $regex: search, $options: 'i' } },
          { phone_number: { $regex: search, $options: 'i' } },
        ],
      },
      { _id: 1 }
    ).lean()

    const astrologerIds = await Astrologer.find(
      {
        $or: [
          { astrologerName: { $regex: search, $options: 'i' } },
          { phone_number: { $regex: search, $options: 'i' } },
        ],
      },
      { _id: 1 }
    ).lean()

    const userIdList = userIds.map((u) => u._id)
    const astrologerIdList = astrologerIds.map((a) => a._id)

    const matchFilter = {
      $or: [
        { user: { $in: userIdList } },
        { astrologer: { $in: astrologerIdList } },
      ],
    }

    const completedChats = await WalletTransactions.aggregate([
      { $match: matchFilter },
      {
        $match: {
          $or: [
            {
              amount: { $ne: 'free chat' },
              $expr: { $gte: [{ $toInt: '$session_time' }, 5] },
            },
            {
              amount: 'free chat',
              $expr: { $gte: [{ $toInt: '$session_time' }, 5] },
            },
          ],
        },
      },
      {
        $lookup: {
          from: 'users',
          let: { userId: '$user' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$userId'] } } },
            { $project: { userName: 1, phone_number: 1 } },
          ],
          as: 'userDetails',
        },
      },
      { $unwind: { path: '$userDetails', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'astrologers',
          let: { astrologerId: '$astrologer' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$astrologerId'] } } },
            { $project: { astrologerName: 1, phone_number: 1, cost: 1 } },
          ],
          as: 'astrologerDetails',
        },
      },
      {
        $unwind: {
          path: '$astrologerDetails',
          preserveNullAndEmptyArrays: true,
        },
      },
      { $sort: { date: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          user: '$userDetails',
          astrologer: '$astrologerDetails',
          amount: 1,
          date: 1,
          session_time: 1,
          refund: 1,
          refundPercentage: 1,
          refund_amount: 1,
          createdAt: 1,
          updatedAt: 1,
          chatCost: {
            $cond: {
              if: { $eq: ['$amount', 'free chat'] },
              then: 'Free',
              else: '$amount',
            },
          },
          chatEndFrom: 1,
          networkSpeed: 1,
          status: 1,
        },
      },
    ])

    const totalFreeChats = completedChats.filter(
      (chat) => chat.amount === 'free chat'
    ).length
    const totalPaidChats = completedChats.length - totalFreeChats

    const formattedChats = completedChats.map((chat) => ({
      ...chat,
      updatedAt: chat.updatedAt
        ? new Date(chat.updatedAt)
            .toLocaleString('en-IN', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            })
            .replace(',', '') // Removes unwanted comma
        : null, // Handle missing updatedAt
    }))

    return res.status(200).json({
      success: true,
      CompletedChats: formattedChats,
      totalResults: formattedChats.length,
      totalPages: Math.ceil(formattedChats.length / limit),
      totalFreeChats: totalFreeChats,
      totalPaidChats: totalPaidChats,
    })
  } catch (error) {
    logger.error('Error fetching search results for completed chats', error)
    return res.status(500).json({
      message: 'Error fetching search results for completed chats',
      error: error.message,
    })
  }
})

//updated code search
router.get('/search-completed-chats-by-astrologer', async (req, res) => {
  logger.info('search-completed-chats-by-astrologer API executed')
  try {
    const search = req.query.search || ''
    const astrologerId = req.query.astrologerId || null
    const page = parseInt(req.query.page) || 1
    const limit = 50
    const skip = (page - 1) * limit

    // Build user and astrologer search filters
    const userIds = await User.find(
      {
        $or: [
          { userName: { $regex: search, $options: 'i' } },
          { phone_number: { $regex: search, $options: 'i' } },
        ],
      },
      { _id: 1 }
    ).lean()

    const astrologerIds = await Astrologer.find(
      {
        $or: [
          { astrologerName: { $regex: search, $options: 'i' } },
          { phone_number: { $regex: search, $options: 'i' } },
        ],
      },
      { _id: 1 }
    ).lean()

    const userIdList = userIds.map((u) => u._id)
    const astrologerIdList = astrologerIds.map((a) => a._id)

    // Build the main match filter
    const matchFilter = {
      $or: [
        { user: { $in: userIdList } },
        { astrologer: { $in: astrologerIdList } },
      ],
    }

    // Add astrologerId filter if provided
    if (astrologerId) {
      matchFilter.astrologer = new mongoose.Types.ObjectId(astrologerId)
    }

    const completedChats = await WalletTransactions.aggregate([
      { $match: matchFilter },
      {
        $match: {
          $or: [
            {
              amount: { $ne: 'free chat' },
              $expr: { $gte: [{ $toInt: '$session_time' }, 5] },
            },
            {
              amount: 'free chat',
              $expr: { $gte: [{ $toInt: '$session_time' }, 5] },
            },
          ],
        },
      },
      {
        $lookup: {
          from: 'users',
          let: { userId: '$user' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$userId'] } } },
            { $project: { userName: 1, phone_number: 1 } },
          ],
          as: 'userDetails',
        },
      },
      { $unwind: { path: '$userDetails', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'astrologers',
          let: { astrologerId: '$astrologer' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$astrologerId'] } } },
            { $project: { astrologerName: 1, phone_number: 1, cost: 1 } },
          ],
          as: 'astrologerDetails',
        },
      },
      {
        $unwind: {
          path: '$astrologerDetails',
          preserveNullAndEmptyArrays: true,
        },
      },
      { $sort: { date: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          user: '$userDetails',
          astrologer: '$astrologerDetails',
          amount: 1,
          date: 1,
          session_time: 1,
          refund: 1,
          refundPercentage: 1,
          refund_amount: 1,
          createdAt: 1,
          updatedAt: 1,
          chatCost: {
            $cond: {
              if: { $eq: ['$amount', 'free chat'] },
              then: 'Free',
              else: '$amount',
            },
          },
          chatEndFrom: 1,
          networkSpeed: 1,
          status: 1,
        },
      },
    ])

    // Get total count for pagination
    const totalCount = await WalletTransactions.countDocuments(matchFilter)

    const totalFreeChats = completedChats.filter(
      (chat) => chat.amount === 'free chat'
    ).length
    const totalPaidChats = completedChats.length - totalFreeChats

    const formattedChats = completedChats.map((chat) => ({
      ...chat,
      updatedAt: chat.updatedAt
        ? new Date(chat.updatedAt)
            .toLocaleString('en-IN', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            })
            .replace(',', '')
        : null,
    }))

    return res.status(200).json({
      success: true,
      CompletedChats: formattedChats,
      totalResults: totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page,
      totalFreeChats: totalFreeChats,
      totalPaidChats: totalPaidChats,
    })
  } catch (error) {
    logger.error('Error fetching search results for completed chats', error)
    return res.status(500).json({
      message: 'Error fetching search results for completed chats',
      error: error.message,
    })
  }
})

router.get('/getUserCall-history/:userId', async (req, res) => {
  logger.info('Get UserCall history by userId')
  const { userId } = req.params

  try {
    const callHistory = await ExotelCallback.find({
      user: userId,
      type: 'call',
    })
      .populate('user', 'userName')
      .populate('astrologer', 'astrologerName')

    if (!callHistory.length) {
      logger.info('No call history found for this user')
      return res.status(200).json({
        success: false,
        message: 'No call history found for this user',
      })
    }

    const historyDetails = callHistory.map((call) => ({
      userName: call.user ? call.user.userName : 'Unknown',
      astrologerName: call.astrologer
        ? call.astrologer.astrologerName
        : 'Unknown',
      from: call.from || 'Unknown',
      to: call.to || 'Unknown',
      date: call.date || 'N/A',
      status: call.status || 'N/A',
      recordingUrl: call.recordingUrl || 'N/A',
    }))
    logger.info('success')
    return res.status(200).json({
      success: true,
      callHistory: historyDetails,
    })
  } catch (error) {
    logger.error('Error fetching user call history', error)
    return res.status(500).json({
      message: 'Error fetching user call history',
      error: error.message,
    })
  }
})

router.get('/get-completedChats-by-date', async (req, res) => {
  try {
    const selectedDate = req.query.date // e.g., "2024-12-05"
    const page = parseInt(req.query.page) || 1
    const limit = 10
    const skip = (page - 1) * limit

    if (!selectedDate) {
      return res.status(400).json({
        success: false,
        message: 'Date query parameter is required',
      })
    }

    // Convert selected date to start and end of the day in the Asia/Kolkata timezone
    const startOfDay = momentTime
      .tz(selectedDate, 'Asia/Kolkata')
      .startOf('day')
      .toDate()

    const endOfDay = momentTime
      .tz(selectedDate, 'Asia/Kolkata')
      .endOf('day')
      .toDate()

    // Fetch completed chats with correct filtering
    const completedChats = await WalletTransactions.find({
      type: 'chat',
      wallet_type: 'production',
      date: { $gte: startOfDay, $lte: endOfDay },
      $or: [
        {
          amount: { $ne: 'free chat' },
          $expr: { $gte: [{ $toInt: '$session_time' }, 4] },
        }, // Include paid chats only if session_time >= 5
        {
          amount: 'free chat',
          $expr: { $gte: [{ $toInt: '$session_time' }, 4] }, // Free chats only if session_time >= 5
        },
      ],
    })
      .populate('user', 'userName phone_number')
      .populate(
        'astrologer',
        'astrologerId astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt'
      )
      .sort({ updatedAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)

    // Fetch total chats count
    const totalChats = await WalletTransactions.find({
      type: 'chat',
      wallet_type: 'production',
      date: { $gte: startOfDay, $lte: endOfDay },
      $or: [
        {
          amount: { $ne: 'free chat' },
          $expr: { $gte: [{ $toInt: '$session_time' }, 4] },
        },
        {
          amount: 'free chat',
          $expr: { $gte: [{ $toInt: '$session_time' }, 4] },
        },
      ],
    })

    // Calculate total amount
    const totalAmount = totalChats.reduce((sum, chat) => {
      const cost =
        chat.amount === 'free chat'
          ? 0
          : Number(chat.amount) / (chat.session_time || 1) // Prevent division by zero
      return sum + (isNaN(cost) ? 0 : cost)
    }, 0)

    // Count free and paid chats
    const totalFreeChats = totalChats.filter(
      (chat) => chat.amount === 'free chat'
    ).length
    const totalPaidChats = totalChats.filter(
      (chat) => chat.amount !== 'free chat'
    ).length

    // Format chat data
    const updatedChats = completedChats.map((chat) => {
      let chatCost = chat.amount === 'free chat' ? 'Free' : Number(chat.amount)

      return {
        ...chat.toObject(),
        chatCost,
        chatEndFrom: chat?.chatEndFrom,
        createdAt: chat.createdAt
          ? new Date(chat.createdAt).toLocaleString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: true,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'NA',
        updatedAt: chat.updatedAt
          ? new Date(chat.updatedAt).toLocaleString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: true,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'NA',
      }
    })

    return res.status(200).json({
      success: true,
      SelectedDate: selectedDate,
      CompletedChats: updatedChats,
      currentPage: page,
      totalPages: Math.ceil(totalChats.length / limit),
      totalFreeChats,
      totalPaidChats,
      totalTransactions: totalChats.length,
      totalAmount,
    })
  } catch (error) {
    return res.status(500).json({
      message: 'Error fetching chats for the selected date',
      error: error.message,
    })
  }
})

router.get('/get-completedChats-by-date-range', async (req, res) => {
  try {
    // const from = req.query.from // e.g., "2024-12-05"
    const from = req.query.from
    const to = req.query.to
    const page = parseInt(req.query.page) || 1
    const limit = 10
    const skip = (page - 1) * limit

    if (!from || !to) {
      return res.status(400).json({
        success: false,
        message: 'from and to query parameter is required',
      })
    }

    const parsedFrom = momentTime(from, 'DD-MM-YYYY', true)
    const parsedTo = momentTime(to, 'DD-MM-YYYY', true)
    const startOfDay = parsedFrom.tz('Asia/Kolkata').startOf('day').toDate()
    const endOfDay = parsedTo.tz('Asia/Kolkata').endOf('day').toDate()

    const completedChats = await WalletTransactions.find({
      type: 'chat',
      wallet_type: 'production',
      date: { $gte: startOfDay, $lte: endOfDay },
      $or: [
        {
          amount: { $ne: 'free chat' },
          $expr: { $gte: [{ $toInt: '$session_time' }, 5] },
        }, // Include paid chats
        {
          amount: 'free chat',
          $expr: { $gte: [{ $toInt: '$session_time' }, 5] }, // Free chats only if session_time >= 5
        },
      ],
    })
      .populate('user', 'userName phone_number')
      .populate(
        'astrologer',
        'astrologerId astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt'
      )
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)

    // Fetch total chats count
    const totalChats = await WalletTransactions.find({
      type: 'chat',
      wallet_type: 'production',
      date: { $gte: startOfDay, $lte: endOfDay },
      $or: [
        {
          amount: { $ne: 'free chat' },
          $expr: { $gte: [{ $toInt: '$session_time' }, 5] },
        },
        {
          amount: 'free chat',
          $expr: { $gte: [{ $toInt: '$session_time' }, 5] },
        },
      ],
    })

    // Calculate total amount
    const totalAmount = totalChats.reduce((sum, chat) => {
      const cost =
        chat.amount === 'free chat'
          ? 0
          : Number(chat.amount) / (chat.session_time || 1) // Prevent division by zero
      return sum + (isNaN(cost) ? 0 : cost)
    }, 0)

    // Count free and paid chats
    const totalFreeChats = totalChats.filter(
      (chat) => chat.amount === 'free chat'
    ).length
    const totalPaidChats = totalChats.filter(
      (chat) => chat.amount !== 'free chat'
    ).length

    // Format chat data
    const updatedChats = completedChats.map((chat) => {
      let chatCost =
        chat.amount === 'free chat'
          ? 'Free'
          : Number(chat.amount) / (chat.session_time || 1)

      return {
        ...chat.toObject(),
        chatCost,
        chatEndFrom: chat?.chatEndFrom,
        createdAt: chat.createdAt
          ? new Date(chat.createdAt).toLocaleString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: true,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'NA',
        updatedAt: chat.updatedAt
          ? new Date(chat.updatedAt).toLocaleString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: true,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'NA',
      }
    })

    return res.status(200).json({
      success: true,
      SelectedDate: from,
      CompletedChats: updatedChats,
      currentPage: page,
      totalPages: Math.ceil(totalChats.length / limit),
      totalFreeChats,
      totalPaidChats,
      totalTransactions: totalChats.length,
      totalAmount,
    })
  } catch (error) {
    return res.status(500).json({
      message: 'Error fetching chats for the selected date',
      error: error.message,
    })
  }
})

// router.get('/get-failed-chats-by-date', async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1
//     const perPage = 10
//     const date = req.query.date

//     // Validate the date parameter
//     if (!date) {
//       return res.status(400).json({
//         success: false,
//         message: 'Date query parameter is required',
//       })
//     }

//     // Convert "Asia/Kolkata" start and end of day to UTC
//     const startOfDayIST = moment.tz(date, 'Asia/Kolkata').startOf('day')
//     const endOfDayIST = moment.tz(date, 'Asia/Kolkata').endOf('day')
//     const startOfDayUTC = startOfDayIST.utc().toDate()
//     const endOfDayUTC = endOfDayIST.utc().toDate()

//     // Aggregation pipeline
//     const failedChats = await Queues.aggregate([
//       // Match failed chats and filter by UTC date range
//       {
//         $match: {
//           status: 'expired',
//           type: 'chat',
//           updatedAt: { $gte: startOfDayUTC, $lte: endOfDayUTC },
//         },
//       },

//       { $sort: { updatedAt: -1 } },

//       // Pagination
//       { $skip: (page - 1) * perPage },
//       { $limit: perPage },

//       // Lookup astrologer details
//       {
//         $lookup: {
//           from: 'astrologers',
//           localField: 'astrologerId',
//           foreignField: '_id',
//           as: 'astrologerDetails',
//         },
//       },

//       // Project required fields
//       {
//         $project: {
//           _id: 1,
//           userId: 1,
//           userName: 1,
//           from: 1,
//           to: 1,
//           type: 1,
//           date: 1,
//           time: 1,
//           time_duration: 1,
//           channelRoomId: 1,
//           gender: 1,
//           place_of_birth: 1,
//           dob: 1,
//           cost: 1,
//           status: 1,
//           createdAt: 1,
//           updatedAt: 1,
//           astrologer: {
//             _id: { $arrayElemAt: ['$astrologerDetails._id', 0] },
//             astrologerName: {
//               $arrayElemAt: ['$astrologerDetails.astrologerName', 0],
//             },
//             phone_number: {
//               $arrayElemAt: ['$astrologerDetails.phone_number', 0],
//             },
//             status: {
//               $arrayElemAt: ['$astrologerDetails.status', 0],
//             },
//             category: {
//               $arrayElemAt: ['$astrologerDetails.category', 0],
//             },
//             known_languages: {
//               $arrayElemAt: ['$astrologerDetails.known_languages', 0],
//             },
//             expertIn: {
//               $arrayElemAt: ['$astrologerDetails.expertIn', 0],
//             },
//             experience: {
//               $arrayElemAt: ['$astrologerDetails.experience', 0],
//             },
//             order_bookings: {
//               $arrayElemAt: ['$astrologerDetails.order_bookings', 0],
//             },
//             cost: { $arrayElemAt: ['$astrologerDetails.cost', 0] },
//             profile_photo: {
//               $arrayElemAt: ['$astrologerDetails.profile_photo', 0],
//             },
//             wallet: {
//               $arrayElemAt: ['$astrologerDetails.wallet', 0],
//             },
//             createdAt: {
//               $arrayElemAt: ['$astrologerDetails.createdAt', 0],
//             },
//             isActive: {
//               $arrayElemAt: ['$astrologerDetails.isActive', 0],
//             },
//           },
//         },
//       },
//     ])

//     // Format chats with "Asia/Kolkata" time
//     const formattedChats = failedChats.map((chat) => ({
//       ...chat,
//       updatedAt: moment(chat.updatedAt)
//         .tz('Asia/Kolkata')
//         .format('DD/MM/YYYY, hh:mm A'),
//     }))

//     // Count total chats for the given date range in UTC
//     const totalChats = await Queues.countDocuments({
//       status: 'expired',
//       type: 'chat',
//       updatedAt: { $gte: startOfDayUTC, $lte: endOfDayUTC },
//     })

//     // Return response
//     return res.status(200).json({
//       success: true,
//       failedChatsList: formattedChats,
//       total: totalChats,
//       currentPage: page,
//       totalPages: Math.ceil(totalChats / perPage),
//     })
//   } catch (error) {
//     // Error handling
//     return res.status(500).json({
//       success: false,
//       message: 'Error fetching failed chats by date',
//       error: error.message,
//     })
//   }
// })
router.get('/get-failed-chats-by-date', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const perPage = 10
    const date = req.query.date

    // Validate the date parameter
    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Date query parameter is required',
      })
    }

    // Convert "Asia/Kolkata" start and end of day to UTC
    const startOfDayIST = moment.tz(date, 'Asia/Kolkata').startOf('day')
    const endOfDayIST = moment.tz(date, 'Asia/Kolkata').endOf('day')
    const startOfDayUTC = startOfDayIST.utc().toDate()
    const endOfDayUTC = endOfDayIST.utc().toDate()

    // Aggregation pipeline
    const failedChats = await Queues.aggregate([
      // Match failed chats and filter by UTC date range
      {
        $match: {
          status: 'expired',
          type: 'chat',
          updatedAt: { $gte: startOfDayUTC, $lte: endOfDayUTC },
        },
      },
      { $sort: { updatedAt: -1 } },
      // Pagination
      { $skip: (page - 1) * perPage },
      { $limit: perPage },
      // Lookup astrologer details
      {
        $lookup: {
          from: 'astrologers',
          localField: 'astrologerId',
          foreignField: '_id',
          as: 'astrologerDetails',
        },
      },
      // Project required fields
      {
        $project: {
          _id: 1,
          userId: 1,
          userName: 1,
          from: 1,
          to: 1,
          type: 1,
          date: 1,
          time: 1,
          waitingTime: 1, // Include waitingTime in projection
          channelRoomId: 1,
          gender: 1,
          place_of_birth: 1,
          dob: 1,
          cost: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          astrologer: {
            _id: { $arrayElemAt: ['$astrologerDetails._id', 0] },
            astrologerName: {
              $arrayElemAt: ['$astrologerDetails.astrologerName', 0],
            },
            phone_number: {
              $arrayElemAt: ['$astrologerDetails.phone_number', 0],
            },
            status: { $arrayElemAt: ['$astrologerDetails.status', 0] },
            category: { $arrayElemAt: ['$astrologerDetails.category', 0] },
            known_languages: {
              $arrayElemAt: ['$astrologerDetails.known_languages', 0],
            },
            expertIn: { $arrayElemAt: ['$astrologerDetails.expertIn', 0] },
            experience: { $arrayElemAt: ['$astrologerDetails.experience', 0] },
            order_bookings: {
              $arrayElemAt: ['$astrologerDetails.order_bookings', 0],
            },
            cost: { $arrayElemAt: ['$astrologerDetails.cost', 0] },
            profile_photo: {
              $arrayElemAt: ['$astrologerDetails.profile_photo', 0],
            },
            wallet: { $arrayElemAt: ['$astrologerDetails.wallet', 0] },
            createdAt: { $arrayElemAt: ['$astrologerDetails.createdAt', 0] },
            isActive: { $arrayElemAt: ['$astrologerDetails.isActive', 0] },
            currentTabVersion: {
              $arrayElemAt: ['$astrologerDetails.currentTabVersion', 0],
            },
            upi: { $arrayElemAt: ['$astrologerDetails.upi', 0] },
          },
        },
      },
    ])

    // Format chats with time duration calculation
    const formattedChats = failedChats.map((chat) => {
      // Calculate duration between waitingTime and updatedAt
      let timeDurationFormatted = '0min'

      if (chat.waitingTime && chat.updatedAt) {
        const waitingTime = new Date(chat.waitingTime)
        const updatedAt = new Date(chat.updatedAt)

        if (!isNaN(waitingTime.getTime()) && !isNaN(updatedAt.getTime())) {
          const diffMs = updatedAt - waitingTime
          let totalMinutes = Math.floor(diffMs / (1000 * 60))

          // Calculate years, months, days, hours, minutes
          const years = Math.floor(totalMinutes / (365 * 24 * 60))
          totalMinutes %= 365 * 24 * 60

          const months = Math.floor(totalMinutes / (30 * 24 * 60))
          totalMinutes %= 30 * 24 * 60

          const days = Math.floor(totalMinutes / (24 * 60))
          totalMinutes %= 24 * 60

          const hours = Math.floor(totalMinutes / 60)
          const minutes = totalMinutes % 60

          // Build formatted string only with non-zero values
          const parts = []
          if (years > 0) parts.push(`${years}y`)
          if (months > 0) parts.push(`${months}m`)
          if (days > 0) parts.push(`${days}d`)
          if (hours > 0) parts.push(`${hours}h`)
          if (minutes > 0 || parts.length === 0) parts.push(`${minutes}min`)

          timeDurationFormatted = parts.join('-')
        }
      }

      return {
        ...chat,
        time_duration: timeDurationFormatted,
        updatedAt: moment(chat.updatedAt)
          .tz('Asia/Kolkata')
          .format('DD/MM/YYYY, hh:mm A'),
        waitingTime: chat.waitingTime
          ? moment(chat.waitingTime)
              .tz('Asia/Kolkata')
              .format('DD/MM/YYYY, hh:mm A')
          : 'N/A',
      }
    })

    // Count total chats for the given date range in UTC
    const totalChats = await Queues.countDocuments({
      status: 'expired',
      type: 'chat',
      updatedAt: { $gte: startOfDayUTC, $lte: endOfDayUTC },
    })

    // Return response
    return res.status(200).json({
      success: true,
      failedChatsList: formattedChats,
      total: totalChats,
      currentPage: page,
      totalPages: Math.ceil(totalChats / perPage),
    })
  } catch (error) {
    // Error handling
    console.error('Error fetching failed chats by date:', error)
    return res.status(500).json({
      success: false,
      message: 'Error fetching failed chats by date',
      error: error.message,
    })
  }
})

//update filter by date expired astrologer
router.get('/get-failed-chats-by-date-expired-astrologer', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const perPage = 10
    const date = req.query.date
    const astrologerId = req.query.astrologerId

    // Validate the date parameter
    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Date query parameter is required',
      })
    }

    // Convert "Asia/Kolkata" start and end of day to UTC
    const startOfDayIST = moment.tz(date, 'Asia/Kolkata').startOf('day')
    const endOfDayIST = moment.tz(date, 'Asia/Kolkata').endOf('day')
    const startOfDayUTC = startOfDayIST.utc().toDate()
    const endOfDayUTC = endOfDayIST.utc().toDate()

    // Build the base match filter
    const matchFilter = {
      status: 'expired',
      type: 'chat',
      updatedAt: { $gte: startOfDayUTC, $lte: endOfDayUTC },
    }

    // Add astrologerId filter if provided
    if (astrologerId) {
      matchFilter.astrologerId = new mongoose.Types.ObjectId(astrologerId)
    }

    // Aggregation pipeline
    const failedChats = await Queues.aggregate([
      // Match failed chats and filter by UTC date range and optional astrologerId
      {
        $match: matchFilter,
      },

      { $sort: { updatedAt: -1 } },

      // Pagination
      { $skip: (page - 1) * perPage },
      { $limit: perPage },

      // Lookup astrologer details
      {
        $lookup: {
          from: 'astrologers',
          localField: 'astrologerId',
          foreignField: '_id',
          as: 'astrologerDetails',
        },
      },

      // Project required fields
      {
        $project: {
          _id: 1,
          userId: 1,
          userName: 1,
          from: 1,
          to: 1,
          type: 1,
          date: 1,
          time: 1,
          time_duration: 1,
          channelRoomId: 1,
          gender: 1,
          place_of_birth: 1,
          dob: 1,
          cost: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          astrologer: {
            _id: { $arrayElemAt: ['$astrologerDetails._id', 0] },
            astrologerName: {
              $arrayElemAt: ['$astrologerDetails.astrologerName', 0],
            },
            phone_number: {
              $arrayElemAt: ['$astrologerDetails.phone_number', 0],
            },
            status: {
              $arrayElemAt: ['$astrologerDetails.status', 0],
            },
            category: {
              $arrayElemAt: ['$astrologerDetails.category', 0],
            },
            known_languages: {
              $arrayElemAt: ['$astrologerDetails.known_languages', 0],
            },
            expertIn: {
              $arrayElemAt: ['$astrologerDetails.expertIn', 0],
            },
            experience: {
              $arrayElemAt: ['$astrologerDetails.experience', 0],
            },
            order_bookings: {
              $arrayElemAt: ['$astrologerDetails.order_bookings', 0],
            },
            cost: { $arrayElemAt: ['$astrologerDetails.cost', 0] },
            profile_photo: {
              $arrayElemAt: ['$astrologerDetails.profile_photo', 0],
            },
            wallet: {
              $arrayElemAt: ['$astrologerDetails.wallet', 0],
            },
            createdAt: {
              $arrayElemAt: ['$astrologerDetails.createdAt', 0],
            },
            isActive: {
              $arrayElemAt: ['$astrologerDetails.isActive', 0],
            },
          },
        },
      },
    ])

    // Format chats with "Asia/Kolkata" time and updated time_duration format
    const formattedChats = failedChats.map((chat) => {
      // Convert time_duration from "hr:min" to "y-m-d-h-min" format
      let timeDurationFormatted = ''
      if (chat.time_duration) {
        const [hoursStr, minutesStr] = chat.time_duration.split(':')
        let totalMinutes =
          (parseInt(hoursStr) || 0) * 60 + (parseInt(minutesStr) || 0)

        const years = Math.floor(totalMinutes / (365 * 24 * 60))
        totalMinutes %= 365 * 24 * 60

        const months = Math.floor(totalMinutes / (30 * 24 * 60))
        totalMinutes %= 30 * 24 * 60

        const days = Math.floor(totalMinutes / (24 * 60))
        totalMinutes %= 24 * 60

        const hours = Math.floor(totalMinutes / 60)
        const minutes = totalMinutes % 60

        const parts = []
        if (years > 0) parts.push(`${years}y`)
        if (months > 0) parts.push(`${months}m`)
        if (days > 0) parts.push(`${days}d`)
        if (hours > 0) parts.push(`${hours}h`)
        if (minutes > 0) parts.push(`${minutes}min`)

        timeDurationFormatted = parts.length > 0 ? parts.join('-') : '0min'
      } else {
        timeDurationFormatted = '0min'
      }

      return {
        ...chat,
        time_duration: timeDurationFormatted, // Updated time duration format
        updatedAt: moment(chat.updatedAt)
          .tz('Asia/Kolkata')
          .format('DD/MM/YYYY, hh:mm A'),
      }
    })

    // Count total chats for the given date range in UTC and optional astrologerId
    const totalChats = await Queues.countDocuments(matchFilter)

    // Return response (maintaining exact same format)
    return res.status(200).json({
      success: true,
      failedChatsList: formattedChats,
      total: totalChats,
      currentPage: page,
      totalPages: Math.ceil(totalChats / perPage),
      filters: {
        date: date,
        astrologerId: astrologerId || 'all',
      },
    })
  } catch (error) {
    // Error handling
    return res.status(500).json({
      success: false,
      message: 'Error fetching failed chats by date',
      error: error.message,
    })
  }
})

router.get('/get-failed-chats-by-range', async (req, res) => {
  try {
    const from = req.query.from || '19-03-2025'
    const to = req.query.to || '20-03-2025'
    const page = parseInt(req.query.page) || 1
    const limit = 10
    const skip = (page - 1) * limit

    // Validate the date parameters
    if (!from || !to) {
      return res.status(400).json({
        success: false,
        message: 'Both "from" and "to" query parameters are required',
      })
    }

    // Convert input dates to "Asia/Kolkata" timezone and get start/end of days
    const parsedFrom = moment
      .tz(from, 'DD-MM-YYYY', 'Asia/Kolkata')
      .startOf('day')
      .toDate()
    const parsedTo = moment
      .tz(to, 'DD-MM-YYYY', 'Asia/Kolkata')
      .endOf('day')
      .toDate()

    // Aggregation pipeline
    const failedChats = await Queues.aggregate([
      {
        $match: {
          status: 'expired',
          type: 'chat',
          updatedAt: { $gte: parsedFrom, $lte: parsedTo },
        },
      },
      { $sort: { updatedAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'astrologers',
          localField: 'astrologerId',
          foreignField: '_id',
          as: 'astrologerDetails',
        },
      },
      {
        $project: {
          _id: 1,
          userId: 1,
          userName: 1,
          from: 1,
          to: 1,
          type: 1,
          date: 1,
          time: 1,
          time_duration: 1,
          channelRoomId: 1,
          gender: 1,
          place_of_birth: 1,
          dob: 1,
          cost: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          astrologer: {
            _id: { $arrayElemAt: ['$astrologerDetails._id', 0] },
            astrologerName: {
              $arrayElemAt: ['$astrologerDetails.astrologerName', 0],
            },
            phone_number: {
              $arrayElemAt: ['$astrologerDetails.phone_number', 0],
            },
            status: { $arrayElemAt: ['$astrologerDetails.status', 0] },
            category: { $arrayElemAt: ['$astrologerDetails.category', 0] },
            known_languages: {
              $arrayElemAt: ['$astrologerDetails.known_languages', 0],
            },
            expertIn: { $arrayElemAt: ['$astrologerDetails.expertIn', 0] },
            experience: { $arrayElemAt: ['$astrologerDetails.experience', 0] },
            order_bookings: {
              $arrayElemAt: ['$astrologerDetails.order_bookings', 0],
            },
            cost: { $arrayElemAt: ['$astrologerDetails.cost', 0] },
            profile_photo: {
              $arrayElemAt: ['$astrologerDetails.profile_photo', 0],
            },
            wallet: { $arrayElemAt: ['$astrologerDetails.wallet', 0] },
            createdAt: { $arrayElemAt: ['$astrologerDetails.createdAt', 0] },
            isActive: { $arrayElemAt: ['$astrologerDetails.isActive', 0] },
          },
        },
      },
    ])

    // Format chats with "Asia/Kolkata" time
    const formattedChats = failedChats.map((chat) => ({
      ...chat,
      updatedAt: moment(chat.updatedAt)
        .tz('Asia/Kolkata')
        .format('DD/MM/YYYY, hh:mm A'),
    }))

    // Count total chats for the given date range
    const totalChats = await Queues.countDocuments({
      status: 'expired',
      type: 'chat',
      updatedAt: { $gte: parsedFrom, $lte: parsedTo },
    })

    // Return response
    return res.status(200).json({
      success: true,
      failedChatsList: formattedChats,
      total: totalChats,
      currentPage: page,
      totalPages: Math.ceil(totalChats / limit),
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching failed chats by date range',
      error: error.message,
    })
  }
})

//updated filter by date-range astrologer all chats expired
// router.get('/get-failed-chats-by-range-astrologer-expired', async (req, res) => {
//   try {
//     const from = req.query.from || '19-03-2025'
//     const to = req.query.to || '20-03-2025'
//     const astrologerId = req.query.astrologerId
//     const page = parseInt(req.query.page) || 1
//     const limit = 10
//     const skip = (page - 1) * limit

//     // Validate the date parameters
//     if (!from || !to) {
//       return res.status(400).json({
//         success: false,
//         message: 'Both "from" and "to" query parameters are required',
//       })
//     }

//     // Convert input dates to "Asia/Kolkata" timezone and get start/end of days
//     const parsedFrom = moment
//       .tz(from, 'DD-MM-YYYY', 'Asia/Kolkata')
//       .startOf('day')
//       .toDate()
//     const parsedTo = moment
//       .tz(to, 'DD-MM-YYYY', 'Asia/Kolkata')
//       .endOf('day')
//       .toDate()

//     // Build the base match filter
//     const matchFilter = {
//       status: 'expired',
//       type: 'chat',
//       updatedAt: { $gte: parsedFrom, $lte: parsedTo }
//     }

//     // Add astrologerId filter if provided
//     if (astrologerId) {
//       matchFilter.astrologerId = new mongoose.Types.ObjectId(astrologerId)
//     }

//     // Aggregation pipeline
//     const failedChats = await Queues.aggregate([
//       {
//         $match: matchFilter
//       },
//       { $sort: { updatedAt: -1 } },
//       { $skip: skip },
//       { $limit: limit },
//       {
//         $lookup: {
//           from: 'astrologers',
//           localField: 'astrologerId',
//           foreignField: '_id',
//           as: 'astrologerDetails',
//         },
//       },
//       {
//         $project: {
//           _id: 1,
//           userId: 1,
//           userName: 1,
//           from: 1,
//           to: 1,
//           type: 1,
//           date: 1,
//           time: 1,
//           time_duration: 1,
//           channelRoomId: 1,
//           gender: 1,
//           place_of_birth: 1,
//           dob: 1,
//           cost: 1,
//           status: 1,
//           createdAt: 1,
//           updatedAt: 1,
//           astrologer: {
//             _id: { $arrayElemAt: ['$astrologerDetails._id', 0] },
//             astrologerName: {
//               $arrayElemAt: ['$astrologerDetails.astrologerName', 0],
//             },
//             phone_number: {
//               $arrayElemAt: ['$astrologerDetails.phone_number', 0],
//             },
//             status: { $arrayElemAt: ['$astrologerDetails.status', 0] },
//             category: { $arrayElemAt: ['$astrologerDetails.category', 0] },
//             known_languages: {
//               $arrayElemAt: ['$astrologerDetails.known_languages', 0],
//             },
//             expertIn: { $arrayElemAt: ['$astrologerDetails.expertIn', 0] },
//             experience: { $arrayElemAt: ['$astrologerDetails.experience', 0] },
//             order_bookings: {
//               $arrayElemAt: ['$astrologerDetails.order_bookings', 0],
//             },
//             cost: { $arrayElemAt: ['$astrologerDetails.cost', 0] },
//             profile_photo: {
//               $arrayElemAt: ['$astrologerDetails.profile_photo', 0],
//             },
//             wallet: { $arrayElemAt: ['$astrologerDetails.wallet', 0] },
//             createdAt: { $arrayElemAt: ['$astrologerDetails.createdAt', 0] },
//             isActive: { $arrayElemAt: ['$astrologerDetails.isActive', 0] },
//           },
//         },
//       },
//     ])

//     // Format chats with "Asia/Kolkata" time
//     const formattedChats = failedChats.map((chat) => ({
//       ...chat,
//       updatedAt: moment(chat.updatedAt)
//         .tz('Asia/Kolkata')
//         .format('DD/MM/YYYY, hh:mm A'),
//     }))

//     // Count total chats for the given filters
//     const totalChats = await Queues.countDocuments(matchFilter)

//     // Return response
//     return res.status(200).json({
//       success: true,
//       failedChatsList: formattedChats,
//       total: totalChats,
//       currentPage: page,
//       totalPages: Math.ceil(totalChats / limit),
//       filters: {
//         dateRange: { from, to },
//         astrologerId: astrologerId || 'all'
//       }
//     })
//   } catch (error) {
//     return res.status(500).json({
//       success: false,
//       message: 'Error fetching failed chats by date range',
//       error: error.message,
//     })
//   }
// })
router.get(
  '/get-failed-chats-by-range-astrologer-expired',
  async (req, res) => {
    try {
      const from = req.query.from || '19-03-2025'
      const to = req.query.to || '20-03-2025'
      const astrologerId = req.query.astrologerId
      const page = parseInt(req.query.page) || 1
      const limit = 10
      const skip = (page - 1) * limit

      // Validate the date parameters
      if (!from || !to) {
        return res.status(400).json({
          success: false,
          message: 'Both "from" and "to" query parameters are required',
        })
      }

      // Convert input dates to "Asia/Kolkata" timezone and get start/end of days
      const parsedFrom = moment
        .tz(from, 'DD-MM-YYYY', 'Asia/Kolkata')
        .startOf('day')
        .toDate()
      const parsedTo = moment
        .tz(to, 'DD-MM-YYYY', 'Asia/Kolkata')
        .endOf('day')
        .toDate()

      // Build the base match filter
      const matchFilter = {
        status: 'expired',
        type: 'chat',
        updatedAt: { $gte: parsedFrom, $lte: parsedTo },
      }

      // Add astrologerId filter if provided
      if (astrologerId) {
        matchFilter.astrologerId = new mongoose.Types.ObjectId(astrologerId)
      }

      // Aggregation pipeline
      const failedChats = await Queues.aggregate([
        {
          $match: matchFilter,
        },
        { $sort: { updatedAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $lookup: {
            from: 'astrologers',
            localField: 'astrologerId',
            foreignField: '_id',
            as: 'astrologerDetails',
          },
        },
        {
          $project: {
            _id: 1,
            userId: 1,
            userName: 1,
            from: 1,
            to: 1,
            type: 1,
            date: 1,
            time: 1,
            time_duration: 1,
            channelRoomId: 1,
            gender: 1,
            place_of_birth: 1,
            dob: 1,
            cost: 1,
            status: 1,
            createdAt: 1,
            updatedAt: 1,
            astrologer: {
              _id: { $arrayElemAt: ['$astrologerDetails._id', 0] },
              astrologerName: {
                $arrayElemAt: ['$astrologerDetails.astrologerName', 0],
              },
              phone_number: {
                $arrayElemAt: ['$astrologerDetails.phone_number', 0],
              },
              status: { $arrayElemAt: ['$astrologerDetails.status', 0] },
              category: { $arrayElemAt: ['$astrologerDetails.category', 0] },
              known_languages: {
                $arrayElemAt: ['$astrologerDetails.known_languages', 0],
              },
              expertIn: { $arrayElemAt: ['$astrologerDetails.expertIn', 0] },
              experience: {
                $arrayElemAt: ['$astrologerDetails.experience', 0],
              },
              order_bookings: {
                $arrayElemAt: ['$astrologerDetails.order_bookings', 0],
              },
              cost: { $arrayElemAt: ['$astrologerDetails.cost', 0] },
              profile_photo: {
                $arrayElemAt: ['$astrologerDetails.profile_photo', 0],
              },
              wallet: { $arrayElemAt: ['$astrologerDetails.wallet', 0] },
              createdAt: { $arrayElemAt: ['$astrologerDetails.createdAt', 0] },
              isActive: { $arrayElemAt: ['$astrologerDetails.isActive', 0] },
            },
          },
        },
      ])

      // Format chats with "Asia/Kolkata" time and updated time_duration format
      const formattedChats = failedChats.map((chat) => {
        // Convert time_duration from "hr:min" to "y-m-d-h-min" format
        let timeDurationFormatted = ''
        if (chat.time_duration) {
          const [hoursStr, minutesStr] = chat.time_duration.split(':')
          let totalMinutes =
            (parseInt(hoursStr) || 0) * 60 + (parseInt(minutesStr) || 0)

          const years = Math.floor(totalMinutes / (365 * 24 * 60))
          totalMinutes %= 365 * 24 * 60

          const months = Math.floor(totalMinutes / (30 * 24 * 60))
          totalMinutes %= 30 * 24 * 60

          const days = Math.floor(totalMinutes / (24 * 60))
          totalMinutes %= 24 * 60

          const hours = Math.floor(totalMinutes / 60)
          const minutes = totalMinutes % 60

          const parts = []
          if (years > 0) parts.push(`${years}y`)
          if (months > 0) parts.push(`${months}m`)
          if (days > 0) parts.push(`${days}d`)
          if (hours > 0) parts.push(`${hours}h`)
          if (minutes > 0) parts.push(`${minutes}min`)

          timeDurationFormatted = parts.length > 0 ? parts.join('-') : '0min'
        } else {
          timeDurationFormatted = '0min'
        }

        return {
          ...chat,
          time_duration: timeDurationFormatted, // Updated time duration format
          updatedAt: moment(chat.updatedAt)
            .tz('Asia/Kolkata')
            .format('DD/MM/YYYY, hh:mm A'),
        }
      })

      // Count total chats for the given filters
      const totalChats = await Queues.countDocuments(matchFilter)

      // Return response (maintaining exact same format)
      return res.status(200).json({
        success: true,
        failedChatsList: formattedChats,
        total: totalChats,
        currentPage: page,
        totalPages: Math.ceil(totalChats / limit),
        filters: {
          dateRange: { from, to },
          astrologerId: astrologerId || 'all',
        },
      })
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Error fetching failed chats by date range',
        error: error.message,
      })
    }
  }
)

router.post('/sendAdminSide-notification', async (req, res) => {
  logger.info('/sendAdminSide-notification')
  try {
    const { title, message, type, phoneNumber } = req.body
    if (!title || !message) {
      logger.error('Missing required fields (title, message)')
      return res
        .status(400)
        .json({ error: 'Missing required fields (title, message)' })
    }
    let filter = {}
    if (type === 'paid') filter = { isFree: false }
    if (type === 'free') filter = { isFree: true }
    if (phoneNumber) {
      filter.phone_number = phoneNumber
    }
    filter.fcmToken = { $ne: '', $exists: true }
    const users = await User.find(filter)
    if (users.length === 0) {
      logger.error('No users found for the selected type or phone number')
      return res.status(404).json({
        message: 'No users found for the selected type or phone number',
      })
    }
    for (const user of users) {
      if (user.fcmToken) {
        // eslint-disable-next-line no-unused-vars
        const notificationStatus = await sendNotification(
          user.fcmToken,
          title,
          message,
          'user'
        )
        logger.debug(
          `Notification sent to ${user.userName} (${user.phone_number}): ${title} - ${message}`
        )
      } else {
        logger.debug(
          `User ${user.userName} (${user.phone_number}) has no FCM token.`
        )
      }
    }
    res.status(200).json({
      message: 'Notification sent successfully',
      users,
    })
  } catch (err) {
    logger.error('Error sending notification:', err)
    res.status(500).json({ error: 'Failed to send notification' })
  }
})

router.post('/sendEngagementNotification-usingUserId', async (req, res) => {
  logger.info('Send Engagement Notification api is Execute')
  try {
    const { userId, title, message } = req.body

    if (!title || !message) {
      logger.info('Missing required fields (title, message)')
      return res.status(400).json({
        success: false,
        error: 'Missing required fields (title, message)',
      })
    }

    const user = await User.findById(userId)
    if (!user) {
      logger.info('No user found with the provided')
      return res.status(404).json({
        success: false,
        error: 'No user found with the provided userId',
      })
    }

    if (!user.fcmToken) {
      logger.error('User has no FCM token')
      return res
        .status(400)
        .json({ success: false, error: 'User has no FCM token' })
    }

    const notificationResponse = await sendNotification(
      user.fcmToken,
      title,
      message,
      'user'
    )
    logger.info('Notification response:', notificationResponse)
    // console.log(notificationResponse);
    return res.status(200).json({
      success: true,
      message: 'Notification sent successfully',
      response: notificationResponse,
    })
  } catch (error) {
    logger.error('Error sending notification:', error)
    return res
      .status(500)
      .json({ success: false, error: 'Failed to send notification' })
  }
})

router.get('/get-completed-exotel-callbacks-data', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const perPage = 10

    const skip = (page - 1) * perPage

    const exotelCallbacks = await ExotelCallback.find({
      type: 'call',
      status: 'completed',
    })
      .populate('user', 'userName')
      .populate(
        'astrologer',
        'astrologerName phone_number status category known_languages expertIn experience call_duration order_bookings cost profile_photo wallet updatedAt isActive currentTabVersion upi'
      )
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(perPage)

    const callbackDetails = exotelCallbacks.map((callback) => {
      return {
        userId: callback.user ? callback.user._id : 'Unknown',
        userName: callback.user ? callback.user.userName : 'Unknown',
        astrologerId: callback.astrologer ? callback.astrologer._id : 'Unknown',
        astrologerName: callback.astrologer
          ? callback.astrologer.astrologerName
          : 'Unknown',
        isActive: callback.astrologer?.isActive || 'NA',
        status: callback.astrologer?.status || 'NA',
        category: callback.astrologer?.category || 'NA',
        currentTabVersion: callback.astrologer?.currentTabVersion || 'NA', // Added field
        upi: callback.astrologer?.upi || 'NA', // Added field
        known_languages: callback.astrologer?.known_languages || 'NA',
        expertIn: callback.astrologer?.expertIn || 'NA',
        experience: callback.astrologer?.experience || 'NA',
        order_bookings: callback.astrologer?.order_bookings || 'NA',
        cost: callback.astrologer?.cost || 'NA',
        profile_photo: callback.astrologer?.profile_photo || 'NA',
        wallet: callback.astrologer?.wallet,
        createdAt: callback?.updatedAt,
        from: callback.from || 'Unknown',
        to: callback.to || 'Unknown',
        date: callback.date || 'N/A',
        sessionCost:
          !isNaN(Number(callback?.callCost)) &&
          !isNaN(Number(callback?.call_duration))
            ? (
                Number(callback.callCost) *
                (Number(callback.call_duration) / 60)
              ).toFixed(2)
            : 'NA',
        callCost: callback?.callCost || 'NA',
        callDuration: callback?.call_duration
          ? `${Math.floor(callback.call_duration / 60)}m ${
              callback.call_duration % 60
            }s`
          : 'NA',
        recordingUrl: callback.recordingUrl || 'N/A',
      }
    })

    const totalItems = await ExotelCallback.countDocuments({
      type: 'call',
      status: 'completed',
    })

    return res.status(200).json({
      success: true,
      currentPage: page,
      totalItems, // Total number of items
      totalPages: Math.ceil(totalItems / perPage), // Total pages
      callbackHistory: callbackDetails,
    })
  } catch (error) {
    return res.status(500).json({
      message: 'Error fetching Exotel callback history',
      error: error.message,
    })
  }
})

// router.get('/get-failed-exotel-callbacks-data', async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1
//     const perPage = 10

//     const skip = (page - 1) * perPage

//     const exotelCallbacks = await ExotelCallback.find({
//       type: 'call',
//       status: { $ne: 'completed' },
//     })
//       .populate('user', 'userName') // Keeping original fields for user
//       .populate(
//         'astrologer',
//         'astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt'
//       )
//       .sort({ updatedAt: -1 })
//       .skip(skip)
//       .limit(perPage)

//     const callbackDetails = exotelCallbacks.map((callback) => {
//       return {
//         userId: callback.user ? callback.user._id : 'Unknown', // Adding userId logic
//         userName: callback.user ? callback.user.userName : 'Unknown',
//         astrologerId: callback.astrologer ? callback.astrologer._id : 'Unknown',
//         astrologerName: callback.astrologer
//           ? callback.astrologer.astrologerName
//           : 'Unknown',
//         status: callback.astrologer.status || 'NA',
//         category: callback.astrologer.category || 'NA',
//         known_languages: callback.astrologer.known_languages || 'NA',
//         expertIn: callback.astrologer.expertIn || 'NA',
//         experience: callback.astrologer.experience || 'NA',
//         order_bookings: callback.astrologer.order_bookings || 'NA',
//         cost: callback.astrologer.cost || 'NA',
//         profile_photo: callback.astrologer.profile_photo || 'NA',
//         wallet: callback.astrologer.wallet,
//         createdAt: callback?.updatedAt,
//         from: callback.from || 'Unknown',
//         to: callback.to || 'Unknown',
//         // status: callback.status || "N/A",
//         date: callback.date || 'N/A',
//         // callCost: callback?.callCost || "NA",
//         sessionCost:
//           !isNaN(Number(callback?.callCost)) &&
//           !isNaN(Number(callback?.call_duration))
//             ? (
//                 Number(callback.callCost) *
//                 (Number(callback.call_duration) / 60)
//               ).toFixed(2)
//             : 'NA',
//         callCost: callback?.callCost || 'NA',
//         callDuration: callback?.call_duration
//           ? `${Math.floor(callback.call_duration / 60)}m ${
//               callback.call_duration % 60
//             }s`
//           : 'NA',
//         recordingUrl: callback.recordingUrl || 'N/A',
//       }
//     })

//     return res.status(200).json({
//       success: true,
//       currentPage: page,
//       totalItems: await ExotelCallback.countDocuments({
//         type: 'call',
//         status: 'failed',
//       }),
//       totalPages: Math.ceil(
//         (await ExotelCallback.countDocuments({
//           type: 'call',
//           status: 'failed',
//         })) / perPage
//       ),
//       callbackHistory: callbackDetails,
//     })
//   } catch (error) {
//     return res.status(500).json({
//       message: 'Error fetching Exotel callback history',
//       error: error.message,
//     })
//   }
// })

//updated code
// Helper function for safe property access
const validatePositiveNumber = (value, maxValue = Number.MAX_SAFE_INTEGER) => {
  const num = Number(value)
  return !isNaN(num) && num >= 0 && num <= maxValue
}

// Helper function to format call duration
const formatCallDuration = (duration) => {
  if (!validatePositiveNumber(duration)) return 'NA'

  const totalSeconds = Math.round(Number(duration))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}m ${seconds}s`
}

// Helper function to calculate session cost
const calculateSessionCost = (callCost, callDuration) => {
  const cost = Number(callCost)
  const duration = Number(callDuration)

  if (!validatePositiveNumber(cost)) return 'NA'
  if (!validatePositiveNumber(duration)) return 'NA'
  if (duration === 0) return '0.00' // Prevent division by zero

  const totalMinutes = duration / 60
  const sessionCost = cost * totalMinutes

  // Handle extremely large values
  if (sessionCost > Number.MAX_SAFE_INTEGER) return 'NA'

  return sessionCost.toFixed(2)
}

// Data transformation function
const transformCallbackData = (callbacks) => {
  return callbacks.map((callback) => {
    const astrologer = callback.astrologer || {}
    const user = callback.user || {}

    return {
      userId: user._id || 'Unknown',
      userName: user.userName || 'Unknown',
      astrologerId: astrologer._id || 'Unknown',
      astrologerName: astrologer.astrologerName || 'Unknown',
      status: astrologer.status || 'NA',
      category: astrologer.category || 'NA',
      known_languages: astrologer.known_languages || 'NA',
      expertIn: astrologer.expertIn || 'NA',
      experience: astrologer.experience || 'NA',
      order_bookings: astrologer.order_bookings || 'NA',
      cost: astrologer.cost || 'NA',
      profile_photo: astrologer.profile_photo || 'NA',
      wallet: astrologer.wallet || {},
      createdAt: callback.updatedAt || 'N/A',
      from: callback.from || 'Unknown',
      to: callback.to || 'Unknown',
      date: callback.date || 'N/A',
      sessionCost: calculateSessionCost(
        callback.callCost,
        callback.call_duration
      ),
      callDuration: formatCallDuration(callback.call_duration),
      callCost: callback.callCost || 'NA',
      recordingUrl: callback.recordingUrl || 'N/A',
    }
  })
}

router.get('/get-failed-exotel-callbacks-data', async (req, res) => {
  try {
    // Validate input
    const page = parseInt(req.query.page) || 1
    const perPage = 10

    if (page < 1) {
      return res.status(400).json({
        success: false,
        message: 'Page number must be positive',
      })
    }

    const skip = (page - 1) * perPage

    // Execute queries in parallel for better performance
    const [exotelCallbacks, totalCount] = await Promise.all([
      ExotelCallback.find({
        type: 'call',
        status: { $ne: 'completed' },
      })
        .populate('user', 'userName')
        .populate(
          'astrologer',
          'astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt currentTabVersion upi'
        )
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(perPage)
        .lean(), // Convert to plain JS objects

      ExotelCallback.countDocuments({
        type: 'call',
        status: 'failed',
      }),
    ])

    // Transform data safely
    const callbackDetails = transformCallbackData(exotelCallbacks)

    return res.status(200).json({
      success: true,
      currentPage: page,
      itemsPerPage: perPage,
      totalItems: totalCount,
      totalPages: Math.ceil(totalCount / perPage),
      callbackHistory: callbackDetails,
      meta: {
        apiVersion: '1.0',
        timestamp: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to fetch Exotel callback history:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    })

    return res.status(500).json({
      success: false,
      message: 'Error fetching Exotel callback history',
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    })
  }
})

router.post('/get-callbacks-by-date', async (req, res) => {
  try {
    const { date, status } = req.body // Date and status provided in the request body
    const page = parseInt(req.query.page) || 1
    const perPage = 10
    const skip = (page - 1) * perPage

    // Validate the date format (e.g., "YYYY-MM-DD")
    if (!date || !momentTime(date, 'YYYY-MM-DD', true).isValid()) {
      return res.status(400).json({
        error: 'Invalid or missing date. Expected format: YYYY-MM-DD.',
      })
    }

    const allowedStatuses = ['completed', 'failed', 'busy', 'no-answer']
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Allowed values: ${allowedStatuses.join(', ')}`,
      })
    }

    // Define the start and end times for the day
    const startOfDay = momentTime(date, 'YYYY-MM-DD')
      .startOf('day')
      .format('YYYY-MM-DD HH:mm:ss')
    const endOfDay = momentTime(date, 'YYYY-MM-DD')
      .endOf('day')
      .format('YYYY-MM-DD HH:mm:ss')

    // Build the query dynamically
    const query = {
      type: 'call', // Fixed value
      date: { $gte: startOfDay, $lte: endOfDay }, // Match all times on the given date
    }

    if (status) {
      query.status = status // Add status filter if provided
    }

    // Fetch callbacks matching the query
    const callbacks = await ExotelCallback.find(query)
      .populate('user', 'userName')
      .populate(
        'astrologer',
        'astrologerName phone_number status category known_languages expertIn experience call_duration order_bookings cost profile_photo wallet createdAt'
      )
      .sort({ updatedAt: -1 }) // Sort by date (descending)
      .skip(skip)
      .limit(perPage)

    // Map the fetched data to the required response format
    const callbackDetails = callbacks.map((callback) => ({
      userId: callback.user ? callback.user._id : 'Unknown',
      userName: callback.user ? callback.user.userName : 'Unknown',
      astrologerId: callback.astrologer ? callback.astrologer._id : 'Unknown',
      astrologerName: callback.astrologer
        ? callback.astrologer.astrologerName
        : 'Unknown',
      category: callback.astrologer.category || 'NA',
      known_languages: callback.astrologer.known_languages || 'NA',
      expertIn: callback.astrologer.expertIn || 'NA',
      experience: callback.astrologer.experience || 'NA',
      order_bookings: callback.astrologer.order_bookings || 'NA',
      cost: callback.astrologer.cost || 'NA',
      profile_photo: callback.astrologer.profile_photo || 'NA',
      wallet: callback.astrologer.wallet,
      createdAt: callback?.updatedAt,
      from: callback.from || 'Unknown',
      to: callback.to || 'Unknown',
      status: callback.astrologer.status || 'N/A',
      date: callback.date || 'N/A',
      sessionCost:
        !isNaN(Number(callback?.callCost)) &&
        !isNaN(Number(callback?.call_duration))
          ? (
              Number(callback.callCost) *
              (Number(callback.call_duration) / 60)
            ).toFixed(2)
          : 'NA',
      callCost: callback?.callCost || 'NA',
      callDuration: callback?.call_duration
        ? `${Math.floor(callback.call_duration / 60)}m ${
            callback.call_duration % 60
          }s`
        : 'NA',
      recordingUrl: callback.recordingUrl || 'N/A',
    }))

    // Count total items and calculate total pages
    const totalItems = await ExotelCallback.countDocuments(query)
    const totalPages = Math.ceil(totalItems / perPage)

    // Return the response
    return res.status(200).json({
      success: true,
      currentPage: page,
      totalItems,
      totalPages,
      callbackHistory: callbackDetails,
    })
  } catch (error) {
    console.error('Error fetching callbacks by date:', error)
    return res.status(500).json({
      message: 'Error fetching callbacks by date',
      error: error.message,
    })
  }
})
router.post('/search-exotel-callbacks', async (req, res) => {
  try {
    const { status } = req.body // Take `status` from the body
    const { page = 1, search = '' } = req.query // Take `page` and `search` from query params
    const perPage = 10
    const skip = (page - 1) * perPage

    // Step 1: Find matching `user` and `astrologer` IDs
    const userIds = await User.find({
      userName: { $regex: search, $options: 'i' },
    }).select('_id')

    const astrologerIds = await Astrologer.find({
      astrologerName: { $regex: search, $options: 'i' },
    }).select('_id')

    // Step 2: Build the search criteria
    const searchCriteria = {
      type: 'call', // Ensure type is "call"
      status, // Dynamically filter by `status` from request body
      $or: [
        { user: { $in: userIds.map((u) => u._id) } }, // Match `user` IDs
        { astrologer: { $in: astrologerIds.map((a) => a._id) } }, // Match `astrologer` IDs
        { from: { $regex: search, $options: 'i' } }, // Match `from`
        { to: { $regex: search, $options: 'i' } }, // Match `to`
      ],
    }

    // Step 3: Query `ExotelCallback` with pagination
    const exotelCallbacks = await ExotelCallback.find(searchCriteria)
      .populate('user', 'userName')
      .populate(
        'astrologer',
        'astrologerName phone_number status category known_languages expertIn experience call_duration order_bookings cost profile_photo wallet createdAt'
      )
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(perPage)

    // Step 4: Map the results
    const callbackDetails = exotelCallbacks.map((callback) => {
      return {
        userName: callback.user ? callback.user.userName : 'Unknown',
        astrologerId: callback.astrologer ? callback.astrologer._id : 'Unknown',
        astrologerName: callback.astrologer
          ? callback.astrologer.astrologerName
          : 'Unknown',
        from: callback.from || 'Unknown',
        category: callback.astrologer?.category || 'NA',
        known_languages: callback.astrologer?.known_languages || 'NA',
        expertIn: callback.astrologer?.expertIn || 'NA',
        experience: callback.astrologer?.experience || 'NA',
        order_bookings: callback.astrologer?.order_bookings || 'NA',
        cost: callback.astrologer?.cost || 'NA',
        profile_photo: callback.astrologer?.profile_photo || 'NA',
        wallet: callback.astrologer?.wallet,
        createdAt: callback.astrologer.createdAt,
        to: callback.to || 'Unknown',
        status: callback.astrologer?.status || 'N/A',
        date: callback.date || 'N/A',
        callCost: callback?.callCost || 'NA',
        recordingUrl: callback.recordingUrl || 'N/A',
      }
    })

    // Step 5: Count total items.
    const totalItems = await ExotelCallback.countDocuments(searchCriteria)

    // Step 6: Send the response
    return res.status(200).json({
      success: true,
      currentPage: page,
      totalItems,
      totalPages: Math.ceil(totalItems / perPage),
      callbackHistory: callbackDetails,
    })
  } catch (error) {
    return res.status(500).json({
      message: 'Error searching Exotel callback history',
      error: error.message,
    })
  }
})
router.post('/filter-exotel-callbacks-by-date', async (req, res) => {
  logger.info('Filter Exotel Callbacks by Date API hit')
  try {
    const { page = 1, limit = 10, date } = req.query

    if (!date) {
      logger.info('Date parameter is required')
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Date parameter is required. Use the format YYYY-MM-DD',
      })
    }

    // Parse pagination values
    const pageNumber = parseInt(page, 10)
    const pageLimit = parseInt(limit, 10)
    const skip = (pageNumber - 1) * pageLimit

    // Query the database using an exact match for the date field
    const exotelCallbacks = await ExotelCallback.find({ date: date })
      .populate('user', 'userName')
      .populate('astrologer', 'astrologerName')
      .sort({ updatedAt: -1 }) // Sort by date in descending order
      .skip(skip) // Skip records for pagination
      .limit(pageLimit) // Limit records per page
      .exec()

    // Get the total count of records for the given date
    const totalItems = await ExotelCallback.countDocuments({ date: date })

    // Check if no records are found
    if (!exotelCallbacks || exotelCallbacks.length === 0) {
      logger.info('No Exotel callbacks found for the selected date')
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No Exotel callbacks found for the selected date',
      })
    }

    // Format the response data
    const callbackDetails = exotelCallbacks.map((callback) => ({
      userName: callback.user ? callback.user.userName : 'Unknown',
      astrologerName: callback.astrologer
        ? callback.astrologer.astrologerName
        : 'Unknown',
      from: callback.from || 'Unknown',
      to: callback.to || 'Unknown',
      status: callback.status || 'N/A',
      date: callback.date || 'N/A',
      callCost: callback.callCost || 'N/A',
      recordingUrl: callback.recordingUrl || 'N/A',
    }))

    // Send success response
    logger.info('Exotel callbacks retrieved successfully')
    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Exotel callbacks retrieved successfully',
      currentPage: pageNumber,
      totalItems,
      totalPages: Math.ceil(totalItems / pageLimit),
      data: callbackDetails,
    })
  } catch (error) {
    logger.error('Error filtering Exotel callbacks by date:', error)
    return res.status(500).json({
      success: false,
      status: 500,
      message: `Server error: ${error.message}`,
    })
  }
})

router.get('/getUserCall-history-data/:userId', async (req, res) => {
  logger.info('Get UserCall history by userId')
  const { userId } = req.params

  let { page = 1, limit = 10 } = req.query

  page = parseInt(page, 10)
  limit = parseInt(limit, 10)

  try {
    const skip = (page - 1) * limit

    const callHistory = await ExotelCallback.find({
      user: userId,
      type: 'call',
    })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'userName')
      .populate('astrologer', 'astrologerName')

    const totalCount = await ExotelCallback.countDocuments({
      user: userId,
      type: 'call',
    })

    if (!callHistory.length) {
      logger.info('No call history found for this user')
      return res.status(200).json({
        success: false,
        message: 'No call history found for this user',
      })
    }

    const historyDetails = callHistory.map((call) => ({
      userName: call.user ? call.user.userName : 'Unknown',
      astrologerName: call.astrologer
        ? call.astrologer.astrologerName
        : 'Unknown',
      from: call.from || 'Unknown',
      to: call.to || 'Unknown',
      date: call.date
        ? moment(call.date).tz('Asia/Kolkata').format('YYYY-MM-DD hh:mm A')
        : 'N/A',
      status: call.status || 'N/A',
      recordingUrl: call.recordingUrl || 'N/A',
    }))

    logger.info('Call history fetched successfully')
    return res.status(200).json({
      success: true,
      callHistory: historyDetails,
      pagination: {
        total: totalCount,
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        perPage: limit,
      },
    })
  } catch (error) {
    logger.error('Error fetching user call history', error)
    return res.status(500).json({
      message: 'Error fetching user call history',
      error: error.message,
    })
  }
})

router.post('/get-cancelled-chats', async (req, res) => {
  try {
    // const page = parseInt(req.query.page) || 1;
    const perPage = 10
    const { page, type } = req.body
    // // console.log("line 1737", page, type);

    const cancelChats = await Queues.aggregate([
      { $match: { status: 'cancelled', type: type } },

      { $sort: { updatedAt: -1 } },

      { $skip: (page - 1) * perPage },
      { $limit: perPage },

      {
        $lookup: {
          from: 'astrologers',
          localField: 'astrologerId',
          foreignField: '_id',
          as: 'astrologerDetails',
        },
      },

      {
        $project: {
          _id: 1,
          userId: 1,
          userName: 1,
          from: 1,
          to: 1,
          type: 1,
          date: 1,
          time: 1,
          time_duration: 1,
          channelRoomId: 1,
          gender: 1,
          place_of_birth: 1,
          dob: 1,
          cost: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          astrologer: {
            _id: { $arrayElemAt: ['$astrologerDetails._id', 0] },
            astrologerName: {
              $arrayElemAt: ['$astrologerDetails.astrologerName', 0],
            },
            phone_number: {
              $arrayElemAt: ['$astrologerDetails.phone_number', 0],
            },
            status: {
              $arrayElemAt: ['$astrologerDetails.status', 0],
            },
            category: {
              $arrayElemAt: ['$astrologerDetails.category', 0],
            },
            known_languages: {
              $arrayElemAt: ['$astrologerDetails.known_languages', 0],
            },
            expertIn: {
              $arrayElemAt: ['$astrologerDetails.expertIn', 0],
            },
            experience: {
              $arrayElemAt: ['$astrologerDetails.experience', 0],
            },
            order_bookings: {
              $arrayElemAt: ['$astrologerDetails.order_bookings', 0],
            },
            cost: { $arrayElemAt: ['$astrologerDetails.cost', 0] },
            profile_photo: {
              $arrayElemAt: ['$astrologerDetails.profile_photo', 0],
            },
            wallet: {
              $arrayElemAt: ['$astrologerDetails.wallet', 0],
            },
            createdAt: {
              $arrayElemAt: ['$astrologerDetails.createdAt', 0],
            },
            currentTabVersion: {
              $arrayElemAt: ['$astrologerDetails.currentTabVersion', 0],
            },
            upi: {
              $arrayElemAt: ['$astrologerDetails.upi', 0],
            },
          },
        },
      },
    ])

    const formattedChats = cancelChats.map((chat) => ({
      ...chat,
      updatedAt: momentTime(chat.updatedAt)
        .tz('Asia/Kolkata')
        .format('DD/MM/YYYY, hh:mm A'),
    }))

    const totalChats = await Queues.countDocuments({
      status: 'cancelled',
      type: type,
    })

    return res.status(200).json({
      success: true,
      cancelChatsList: formattedChats,
      total: totalChats,
      currentPage: page,
      totalPages: Math.ceil(totalChats / perPage),
    })
  } catch (error) {
    return res.status(500).json({
      message: 'Error fetching cancelled chats',
      error: error.message,
    })
  }
})

router.post('/get-cancelled-chats-by-date', async (req, res) => {
  try {
    // const page = parseInt(req.query.page) || 1;
    const perPage = 10
    // const date = req.query.date;
    const { date, page, type } = req.body

    // Validate the date parameter
    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Date query parameter is required',
      })
    }

    // Convert "Asia/Kolkata" start and end of day to UTC
    const startOfDayIST = moment.tz(date, 'Asia/Kolkata').startOf('day')
    const endOfDayIST = moment.tz(date, 'Asia/Kolkata').endOf('day')
    const startOfDayUTC = startOfDayIST.utc().toDate()
    const endOfDayUTC = endOfDayIST.utc().toDate()

    // Aggregation pipeline
    const cancelChats = await Queues.aggregate([
      // Match failed chats and filter by UTC date range
      {
        $match: {
          status: 'cancelled',
          type: type,
          updatedAt: { $gte: startOfDayUTC, $lte: endOfDayUTC },
        },
      },

      { $sort: { updatedAt: -1 } },

      // Pagination
      { $skip: (page - 1) * perPage },
      { $limit: perPage },

      // Lookup astrologer details
      {
        $lookup: {
          from: 'astrologers',
          localField: 'astrologerId',
          foreignField: '_id',
          as: 'astrologerDetails',
        },
      },

      // Project required fields
      {
        $project: {
          _id: 1,
          userId: 1,
          userName: 1,
          from: 1,
          to: 1,
          type: 1,
          date: 1,
          time: 1,
          time_duration: 1,
          channelRoomId: 1,
          gender: 1,
          place_of_birth: 1,
          dob: 1,
          cost: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          astrologer: {
            _id: { $arrayElemAt: ['$astrologerDetails._id', 0] },
            astrologerName: {
              $arrayElemAt: ['$astrologerDetails.astrologerName', 0],
            },
            phone_number: {
              $arrayElemAt: ['$astrologerDetails.phone_number', 0],
            },
            status: {
              $arrayElemAt: ['$astrologerDetails.status', 0],
            },
            category: {
              $arrayElemAt: ['$astrologerDetails.category', 0],
            },
            known_languages: {
              $arrayElemAt: ['$astrologerDetails.known_languages', 0],
            },
            expertIn: {
              $arrayElemAt: ['$astrologerDetails.expertIn', 0],
            },
            experience: {
              $arrayElemAt: ['$astrologerDetails.experience', 0],
            },
            order_bookings: {
              $arrayElemAt: ['$astrologerDetails.order_bookings', 0],
            },
            cost: { $arrayElemAt: ['$astrologerDetails.cost', 0] },
            profile_photo: {
              $arrayElemAt: ['$astrologerDetails.profile_photo', 0],
            },
            wallet: {
              $arrayElemAt: ['$astrologerDetails.wallet', 0],
            },
            createdAt: {
              $arrayElemAt: ['$astrologerDetails.createdAt', 0],
            },
          },
        },
      },
    ])

    // Format chats with "Asia/Kolkata" time
    const formattedChats = cancelChats.map((chat) => ({
      ...chat,
      updatedAt: moment(chat.updatedAt)
        .tz('Asia/Kolkata')
        .format('DD/MM/YYYY, hh:mm A'),
    }))

    // Count total chats for the given date range in UTC
    const totalChats = await Queues.countDocuments({
      status: 'cancelled',
      type: type,
      updatedAt: { $gte: startOfDayUTC, $lte: endOfDayUTC },
    })

    // Return response
    return res.status(200).json({
      success: true,
      cancelChatsList: formattedChats,
      total: totalChats,
      currentPage: page,
      totalPages: Math.ceil(totalChats / perPage),
    })
  } catch (error) {
    // Error handling
    return res.status(500).json({
      success: false,
      message: 'Error fetching cancelled chats by date',
      error: error.message,
    })
  }
})

router.post('/search-cancelled-chats', async (req, res) => {
  logger.info('search-cancelled-chats api is start')
  try {
    const { search, type } = req.body
    const searchRegex = new RegExp(search, 'i')

    const cancelChats = await Queues.aggregate([
      // Match for cancelled status (e.g., 'expired')
      {
        $match: {
          status: 'cancelled',
          type: type, // Targeting cancelled chats with status 'expired'
        },
      },

      // Lookup for astrologer details
      {
        $lookup: {
          from: 'astrologers',
          localField: 'astrologerId',
          foreignField: '_id',
          as: 'astrologerDetails',
        },
      },

      // Lookup for user details
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'userDetails',
        },
      },

      // Apply search filter based on user or astrologer information
      {
        $match: {
          $or: [
            { 'userDetails.userName': searchRegex }, // Search by user's name
            { 'userDetails.phone_number': searchRegex }, // Search by user's phone number
            { 'astrologerDetails.astrologerName': searchRegex }, // Search by astrologer's name
            { 'astrologerDetails.phone_number': searchRegex }, // Search by astrologer's phone number
          ],
        },
      },

      // Sort by updatedAt in descending order
      {
        $sort: { updatedAt: -1 },
      },

      // Project the required cancelled and include astrologer details
      {
        $project: {
          _id: 1,
          userId: 1,
          userName: { $arrayElemAt: ['$userDetails.userName', 0] },
          userPhone: {
            $arrayElemAt: ['$userDetails.phone_number', 0],
          },
          from: 1,
          to: 1,
          type: 1,
          date: 1,
          time: 1,
          time_duration: 1,
          channelRoomId: 1,
          gender: 1,
          place_of_birth: 1,
          dob: 1,
          cost: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          astrologer: {
            _id: { $arrayElemAt: ['$astrologerDetails._id', 0] },
            astrologerName: {
              $arrayElemAt: ['$astrologerDetails.astrologerName', 0],
            },
            phone_number: {
              $arrayElemAt: ['$astrologerDetails.phone_number', 0],
            },
            status: {
              $arrayElemAt: ['$astrologerDetails.status', 0],
            },
            category: {
              $arrayElemAt: ['$astrologerDetails.category', 0],
            },
            known_languages: {
              $arrayElemAt: ['$astrologerDetails.known_languages', 0],
            },
            expertIn: {
              $arrayElemAt: ['$astrologerDetails.expertIn', 0],
            },
            experience: {
              $arrayElemAt: ['$astrologerDetails.experience', 0],
            },
            order_bookings: {
              $arrayElemAt: ['$astrologerDetails.order_bookings', 0],
            },
            cost: { $arrayElemAt: ['$astrologerDetails.cost', 0] },
            profile_photo: {
              $arrayElemAt: ['$astrologerDetails.profile_photo', 0],
            },
          },
        },
      },
    ])

    // Format the response
    const responseChats = cancelChats.map((chat) => ({
      _id: chat._id,
      userId: chat.userId,
      userName: chat.userName,
      userPhone: chat.userPhone,
      from: chat.from,
      to: chat.astrologer ? chat.astrologer.phone_number : null,
      type: chat.type,
      date: chat.date,
      time: chat.time,
      astrologerId: chat.astrologer ? chat.astrologer._id : null,
      astrologerName: chat.astrologer ? chat.astrologer.astrologerName : null,
      time_duration: chat.time_duration,
      channelRoomId: chat.channelRoomId,
      gender: chat.gender,
      place_of_birth: chat.place_of_birth,
      dob: chat.dob,
      cost: chat.cost,
      status: chat.status,
      createdAt: chat.createdAt,
      updatedAt: momentTime(chat.updatedAt)
        .tz('Asia/Kolkata')
        .format('MM/DD/YYYY, hh:mm A'),
      astrologer: chat.astrologer, // Include astrologer object in the response
    }))

    // Return the formatted response
    logger.info('success')
    return res.status(200).json({
      success: true,
      chats: responseChats,
    })
  } catch (error) {
    logger.error('Error searching cancelled chat details', error)
    return res.status(500).json({
      success: false,
      message: 'Error searching cancelled chat details',
    })
  }
})

router.get('/get-completed-failed-chats', async (req, res) => {
  logger.info('get completed chats api is execute')
  try {
    const page = parseInt(req.query.page) || 1
    const limit = 10
    const skip = (page - 1) * limit
    const completedFailedChats = await WalletTransactions.find({
      type: 'chat',
      wallet_type: 'production',
      $expr: { $lt: [{ $toDouble: '$session_time' }, 4] },
    })
      .populate('user', 'userId userName phone_number')
      .populate(
        'astrologer',
        'astrologerId astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt currentTabVersion upi'
      )
      .sort({ updatedAt: -1 })
      .limit(limit)
      .skip(skip)

    const totalFailedChats = await WalletTransactions.find({
      type: 'chat',
      wallet_type: 'production',
      $expr: { $lt: [{ $toDouble: '$session_time' }, 4] },
    })
    const totalFailedFreeChats = totalFailedChats.filter(
      (chat) => chat.amount === 'free chat'
    ).length
    const totalFailedPaidChats = totalFailedChats.filter(
      (chat) => chat.amount !== 'free chat'
    ).length

    const totalFailedAmount = totalFailedChats
      .filter((chat) => chat.amount !== 'free chat')
      .reduce((sum, chat) => sum + Number(chat.amount), 0)

    const updatedFailedChats = completedFailedChats.map((chat) => {
      const chatCost =
        chat.amount === 'free chat' ? 'Free' : chat.amount / chat.session_time

      // need change what is usw
      // eslint-disable-next-line no-unused-vars
      const chatroomId = Chatroom.findOne({
        userId: completedFailedChats.user,
        astrologerId: completedFailedChats.astrologer,
      })

      return {
        ...chat.toObject(),
        chatCost,
        createdAt: chat.createdAt
          ? chat.createdAt.toLocaleString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: true,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'NA',
        updatedAt: chat.updatedAt
          ? chat.updatedAt.toLocaleString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: true,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'NA',
      }
    })

    const totalFailedTransactions = await WalletTransactions.countDocuments({
      $expr: { $lt: [{ $toDouble: '$session_time' }, 5] },
    })
    logger.info('success')
    return res.status(200).json({
      success: true,
      CompletedFailedChats: updatedFailedChats,
      currentPage: page,
      totalPages: Math.ceil(totalFailedTransactions / limit),
      totalFailedFreeChats: totalFailedFreeChats,
      totalFailedPaidChats: totalFailedPaidChats,
      totalFailedTransactions: totalFailedTransactions,
      totalFailedAmount: totalFailedAmount,
    })
  } catch (error) {
    logger.error('Error fetching completed Failed Chats', error)
    return res.status(500).json({
      message: 'Error fetching completedFailed Chats',
      error: error.message,
    })
  }
})

router.get('/search-completed-Failed-chats', async (req, res) => {
  logger.info('search-completed-Failed-chats api')
  try {
    const search = req.query.search || ''

    const completedFailedChats = await WalletTransactions.aggregate([
      {
        $lookup: {
          from: 'users',
          localField: 'user',
          foreignField: '_id',
          as: 'userDetails',
        },
      },
      {
        $lookup: {
          from: 'astrologers',
          localField: 'astrologer',
          foreignField: '_id',
          as: 'astrologerDetails',
        },
      },
      {
        $unwind: {
          path: '$userDetails',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $unwind: {
          path: '$astrologerDetails',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $match: {
          $and: [
            {
              $or: [
                {
                  'userDetails.userName': {
                    $regex: search,
                    $options: 'i',
                  },
                },
                {
                  'astrologerDetails.astrologerName': {
                    $regex: search,
                    $options: 'i',
                  },
                },
                {
                  'userDetails.phone_number': {
                    $regex: search,
                    $options: 'i',
                  },
                },
                {
                  'astrologerDetails.phone_number': {
                    $regex: search,
                    $options: 'i',
                  },
                },
              ],
            },
            {
              $expr: { $lt: [{ $toDouble: '$session_time' }, 5] },
            },
          ],
        },
      },
      {
        $sort: { date: -1 },
      },
      {
        $project: {
          user: '$userDetails',
          astrologer: '$astrologerDetails',
          amount: 1,
          date: 1,
          user_wallet: 1,
          astrologer_wallet: 1,
          type: 1,
          session_time: 1,
          refund: 1,
          refundPercentage: 1,
          refund_amount: 1,
          createdAt: 1,
          updatedAt: 1,
          chatEndFrom: 1,
          networkSpeed: 1,
          status: 1,
        },
      },
    ])

    const updatedFailedChats = completedFailedChats.map((chat) => {
      const chatCost =
        chat.session_time !== 0 ? chat.amount / chat.session_time : 0
      return {
        ...chat,
        chatCost,
      }
    })

    const totalFailedFreeChats = updatedFailedChats.filter(
      (chat) => chat.amount === 'free chat'
    ).length
    const totalFailedPaidChats = updatedFailedChats.filter(
      (chat) => chat.amount !== 'free chat'
    ).length

    logger.info('success')
    return res.status(200).json({
      success: true,
      CompletedFailedChats: updatedFailedChats,
      totalResults: updatedFailedChats.length,
      totalFailedFreeChats: totalFailedFreeChats,
      totalFailedPaidChats: totalFailedPaidChats,
    })
  } catch (error) {
    logger.error('Error fetching search results for completed Chats', error)
    return res.status(500).json({
      message: 'Error fetching search results for completed Chats',
      error: error.message,
    })
  }
})

//update code here
router.get('/search-completed-Failed-chats-oneastrologer', async (req, res) => {
  logger.info('search-completed-Failed-chats-oneastrologer api')
  try {
    const { search = '', astrologerId } = req.query

    // Validate astrologerId
    if (!astrologerId || !mongoose.Types.ObjectId.isValid(astrologerId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid Astrologer ID is required',
      })
    }

    const astrologerObjectId = new mongoose.Types.ObjectId(astrologerId)

    const completedFailedChats = await WalletTransactions.aggregate([
      {
        $match: {
          astrologer: astrologerObjectId,
          $expr: { $lt: [{ $toDouble: '$session_time' }, 5] },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'user',
          foreignField: '_id',
          as: 'userDetails',
        },
      },
      {
        $lookup: {
          from: 'astrologers',
          localField: 'astrologer',
          foreignField: '_id',
          as: 'astrologerDetails',
        },
      },
      {
        $unwind: {
          path: '$userDetails',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $unwind: {
          path: '$astrologerDetails',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $match: search
          ? {
              $or: [
                { 'userDetails.userName': { $regex: search, $options: 'i' } },
                {
                  'userDetails.phone_number': { $regex: search, $options: 'i' },
                },
              ],
            }
          : {},
      },
      {
        $sort: { date: -1 },
      },
      {
        $project: {
          _id: 1,
          user: {
            _id: '$userDetails._id',
            userId: '$userDetails.userId',
            userName: '$userDetails.userName',
            phone_number: '$userDetails.phone_number',
          },
          astrologer: {
            _id: '$astrologerDetails._id',
            astrologerName: '$astrologerDetails.astrologerName',
            phone_number: '$astrologerDetails.phone_number',
            profile_photo: '$astrologerDetails.profile_photo',
            category: '$astrologerDetails.category',
            known_languages: '$astrologerDetails.known_languages',
            expertIn: '$astrologerDetails.expertIn',
            experience: '$astrologerDetails.experience',
            cost: '$astrologerDetails.cost',
            order_bookings: '$astrologerDetails.order_bookings',
            status: '$astrologerDetails.status',
            wallet: '$astrologerDetails.wallet',
            createdAt: '$astrologerDetails.createdAt',
          },
          amount: 1,
          date: 1,
          user_wallet: 1,
          astrologer_wallet: 1,
          type: 1,
          session_time: 1,
          refund: 1,
          wallet_type: 1,
          chatEndFrom: 1,
          createdAt: 1,
          updatedAt: 1,
          __v: 1,
          chatEndFrom: 1,
          networkSpeed: 1,
          status: 1,
        },
      },
    ])

    // Format the response data
    const updatedFailedChats = completedFailedChats.map((chat) => {
      const chatCost =
        chat.amount === 'free chat'
          ? 'Free'
          : (chat.amount / chat.session_time).toFixed(2)

      return {
        ...chat,
        chatCost,
        createdAt: chat.createdAt
          ? new Date(chat.createdAt).toLocaleString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: true,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'NA',
        updatedAt: chat.updatedAt
          ? new Date(chat.updatedAt).toLocaleString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: true,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'NA',
      }
    })

    // Calculate counts
    const totalFailedFreeChats = updatedFailedChats.filter(
      (chat) => chat.amount === 'free chat'
    ).length
    const totalFailedPaidChats = updatedFailedChats.filter(
      (chat) => chat.amount !== 'free chat'
    ).length
    const totalFailedAmount = updatedFailedChats
      .filter((chat) => chat.amount !== 'free chat')
      .reduce((sum, chat) => sum + Number(chat.amount), 0)

    logger.info('success')
    return res.status(200).json({
      success: true,
      CompletedFailedChats: updatedFailedChats,
      totalResults: updatedFailedChats.length,
      totalFailedFreeChats,
      totalFailedPaidChats,
      totalFailedAmount,
      astrologerDetails: completedFailedChats[0]?.astrologer || null,
    })
  } catch (error) {
    logger.error('Error fetching search results for completed Chats', error)
    return res.status(500).json({
      success: false,
      message: 'Error fetching search results for completed Chats',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    })
  }
})
router.get('/get-completedFailedChats-by-date', async (req, res) => {
  try {
    const selectedDate = req.query.date
    const page = parseInt(req.query.page) || 1
    const limit = 10
    const skip = (page - 1) * limit

    if (!selectedDate) {
      return res.status(400).json({
        success: false,
        message: 'Date query parameter is required',
      })
    }
    const startOfDay = momentTime
      .tz(selectedDate, 'Asia/Kolkata')
      .startOf('day')
      .toDate()

    const endOfDay = momentTime
      .tz(selectedDate, 'Asia/Kolkata')
      .endOf('day')
      .toDate()
    const completedFailedChats = await WalletTransactions.find({
      type: 'chat',
      wallet_type: 'production',
      date: { $gte: startOfDay, $lte: endOfDay },
      $expr: { $lt: [{ $toDouble: '$session_time' }, 4] },
    })
      .populate('user', 'userName phone_number')
      .populate(
        'astrologer',
        'astrologerId astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt'
      )
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)

    const totalFailedChats = await WalletTransactions.find({
      type: 'chat',
      wallet_type: 'production',
      date: { $gte: startOfDay, $lte: endOfDay },
      $expr: { $lt: [{ $toDouble: '$session_time' }, 4] },
    })

    const totalFailedAmount = totalFailedChats.reduce((sum, chat) => {
      const cost =
        chat.amount === 'free chat'
          ? 0
          : Number(chat.amount) / chat.session_time
      return sum + (isNaN(cost) ? 0 : cost)
    }, 0)

    const totalFailedFreeChats = totalFailedChats.filter(
      (chat) => chat.amount === 'free chat'
    ).length

    const totalFailedPaidChats = totalFailedChats.filter(
      (chat) => chat.amount !== 'free chat'
    ).length

    const updatedFailedChats = completedFailedChats.map((chat) => {
      const chatCost =
        chat.amount === 'free chat'
          ? 0
          : Number(chat.amount) / chat.session_time

      return {
        ...chat.toObject(),
        chatCost,
        createdAt: chat.createdAt
          ? chat.createdAt.toLocaleString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: true,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'NA',
        updatedAt: chat.updatedAt
          ? chat.updatedAt.toLocaleString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: true,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'NA',
      }
    })

    const totalFailedTransactions = totalFailedChats.length

    return res.status(200).json({
      success: true,
      SelectedDate: selectedDate,
      CompletedFailedChats: updatedFailedChats,
      currentPage: page,
      totalPages: Math.ceil(totalFailedTransactions / limit),
      totalFailedFreeChats: totalFailedFreeChats,
      totalFailedPaidChats: totalFailedPaidChats,
      totalFailedTransactions: totalFailedTransactions,
      totalFailedAmount: totalFailedAmount,
    })
  } catch (error) {
    return res.status(500).json({
      message: 'Error fetching chats for the selected date',
      error: error.message,
    })
  }
})

//update code for oneAstrologerfailed-chat
router.get('/get-oneastrologer-FailedChats-by-date', async (req, res) => {
  logger.info(
    'get completed failed chats by date and astrologer API is executing'
  )
  try {
    const { date: selectedDate, astrologerId, page = 1 } = req.query
    const limit = 10
    const skip = (page - 1) * limit

    // Validate required parameters
    if (!selectedDate) {
      return res.status(400).json({
        success: false,
        message: 'Date query parameter is required',
      })
    }

    if (!astrologerId || !mongoose.Types.ObjectId.isValid(astrologerId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid Astrologer ID is required',
      })
    }

    const astrologerObjectId = new mongoose.Types.ObjectId(astrologerId)

    // Calculate date range
    const startOfDay = momentTime
      .tz(selectedDate, 'Asia/Kolkata')
      .startOf('day')
      .toDate()

    const endOfDay = momentTime
      .tz(selectedDate, 'Asia/Kolkata')
      .endOf('day')
      .toDate()

    // Base query with both date and astrologer filters
    const baseQuery = {
      type: 'chat',
      wallet_type: 'production',
      date: { $gte: startOfDay, $lte: endOfDay },
      astrologer: astrologerObjectId,
      $expr: { $lt: [{ $toDouble: '$session_time' }, 5] },
    }

    // Execute all queries in parallel for better performance
    const [
      completedFailedChats,
      totalFailedChats,
      totalFailedFreeChats,
      totalFailedPaidChats,
      paidChats,
    ] = await Promise.all([
      WalletTransactions.find(baseQuery)
        .populate('user', 'userId userName phone_number')
        .populate(
          'astrologer',
          'astrologerName phone_number profile_photo category known_languages expertIn experience cost order_bookings status wallet createdAt'
        )
        .sort({ updatedAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),

      WalletTransactions.countDocuments(baseQuery),

      WalletTransactions.countDocuments({ ...baseQuery, amount: 'free chat' }),

      WalletTransactions.countDocuments({
        ...baseQuery,
        amount: { $ne: 'free chat' },
      }),

      WalletTransactions.find({ ...baseQuery, amount: { $ne: 'free chat' } }),
    ])

    // Calculate total failed amount
    const totalFailedAmount = paidChats.reduce(
      (sum, chat) => sum + Number(chat.amount),
      0
    )

    // Format the response data to match your reference API format
    const updatedFailedChats = completedFailedChats.map((chat) => {
      const chatCost =
        chat.amount === 'free chat'
          ? 'Free'
          : (chat.amount / chat.session_time).toFixed(2)

      return {
        _id: chat._id,
        user: {
          _id: chat.user?._id,
          userId: chat.user?.userId,
          userName: chat.user?.userName,
          phone_number: chat.user?.phone_number,
        },
        astrologer: {
          _id: chat.astrologer?._id,
          astrologerName: chat.astrologer?.astrologerName,
          phone_number: chat.astrologer?.phone_number,
          profile_photo: chat.astrologer?.profile_photo || '',
          category: chat.astrologer?.category,
          known_languages: chat.astrologer?.known_languages || [],
          expertIn: chat.astrologer?.expertIn || [],
          experience: chat.astrologer?.experience || '0 years',
          cost: chat.astrologer?.cost || '0',
          order_bookings: chat.astrologer?.order_bookings || 0,
          status: chat.astrologer?.status || 'inactive',
          wallet: chat.astrologer?.wallet || 0,
          createdAt: chat.astrologer?.createdAt,
        },
        amount: chat.amount,
        date: chat.date,
        type: chat.type,
        user_wallet: chat.user_wallet,
        astrologer_wallet: chat.astrologer_wallet,
        session_time: chat.session_time,
        refund: chat.refund || false,
        wallet_type: chat.wallet_type,
        chatEndFrom: chat.chatEndFrom || 'user-User',
        chatCost,
        createdAt: chat.createdAt
          ? chat.createdAt.toLocaleString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: true,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'NA',
        updatedAt: chat.updatedAt
          ? chat.updatedAt.toLocaleString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: true,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'NA',
        __v: chat.__v || 0,
      }
    })

    logger.info(
      'Successfully fetched completed failed chats by date and astrologer'
    )
    return res.status(200).json({
      success: true,
      SelectedDate: selectedDate,
      CompletedFailedChats: updatedFailedChats,
      currentPage: Number(page),
      totalPages: Math.ceil(totalFailedChats / limit),
      totalFailedFreeChats,
      totalFailedPaidChats,
      totalFailedTransactions: totalFailedChats,
      totalFailedAmount,
      astrologerDetails: completedFailedChats[0]?.astrologer || null,
    })
  } catch (error) {
    logger.error(
      'Error fetching completed failed chats by date and astrologer:',
      error
    )
    return res.status(500).json({
      success: false,
      message: 'Error fetching chats for the selected date',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    })
  }
})
//end update code

router.post('/updateActive/:userId', async (req, res) => {
  logger.info('update active of astrologer api is executing')
  try {
    const { userId } = req.params
    const { isActive } = req.body

    const updatedUser = await User.findOneAndUpdate(
      { _id: userId },
      { isActive: isActive },
      { new: true }
    )
    logger.info('update active of User api is successfully executed')
    return res.status(200).json({
      success: true,
      message: "User's active status updated successfully.",
      data: updatedUser,
    })
  } catch (error) {
    logger.info(
      'update active of User api had occurred error',
      error?.message ?? ''
    )
    return res.status(500).json({
      success: false,
      message: "Error updating the User's active status.",
    })
  }
})

router.get('/get-completedFailedChats-by-date-range', async (req, res) => {
  const from = req.query.from
  const to = req.query.to
  const page = parseInt(req.query.page) || 1
  const limit = 10
  const skip = (page - 1) * limit

  try {
    if (!from || !to) {
      return res.status(400).json({
        success: false,
        message: "Both 'from' and 'to' date parameters are required",
      })
    }

    const parsedFrom = momentTime(from, 'DD-MM-YYYY', true)
    const parsedTo = momentTime(to, 'DD-MM-YYYY', true)

    if (!parsedFrom.isValid() || !parsedTo.isValid()) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format. Use 'DD-MM-YYYY'.",
      })
    }

    const startOfDay = parsedFrom.tz('Asia/Kolkata').startOf('day').toDate()
    const endOfDay = parsedTo.tz('Asia/Kolkata').endOf('day').toDate()

    const completedFailedChats = await WalletTransactions.find({
      type: 'chat',
      wallet_type: 'production',
      date: { $gte: startOfDay, $lte: endOfDay },
      $expr: { $lt: [{ $toDouble: '$session_time' }, 5] },
    })
      .populate('user', 'userName phone_number')
      .populate(
        'astrologer',
        'astrologerId astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt'
      )
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)

    const totalFailedChats = await WalletTransactions.find({
      type: 'chat',
      wallet_type: 'production',
      date: { $gte: startOfDay, $lte: endOfDay },
      $expr: { $lt: [{ $toDouble: '$session_time' }, 5] },
    })

    const totalFailedAmount = totalFailedChats.reduce((sum, chat) => {
      const cost =
        chat.amount === 'free chat'
          ? 0
          : Number(chat.amount) / chat.session_time
      return sum + (isNaN(cost) ? 0 : cost)
    }, 0)

    const totalFailedFreeChats = totalFailedChats.filter(
      (chat) => chat.amount === 'free chat'
    ).length
    const totalFailedPaidChats = totalFailedChats.filter(
      (chat) => chat.amount !== 'free chat'
    ).length

    const updatedFailedChats = completedFailedChats.map((chat) => {
      const chatCost =
        chat.amount === 'free chat'
          ? 0
          : Number(chat.amount) / chat.session_time

      return {
        ...chat.toObject(),
        chatCost,
        createdAt: chat.createdAt
          ? chat.createdAt.toLocaleString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: true,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'NA',
        updatedAt: chat.updatedAt
          ? chat.updatedAt.toLocaleString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: true,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'NA',
      }
    })

    const totalFailedTransactions = totalFailedChats.length

    return res.status(200).json({
      success: true,
      dateRange: { from, to },
      CompletedFailedChats: updatedFailedChats,
      currentPage: page,
      totalPages: Math.ceil(totalFailedTransactions / limit),
      totalFailedFreeChats,
      totalFailedPaidChats,
      totalFailedTransactions,
      totalFailedAmount,
    })
  } catch (error) {
    return res.status(500).json({
      message: 'Error fetching chats for the selected date range',
      error: error.message,
    })
  }
})

//new upadate code for oneastrologer failed chat by date range
router.get(
  '/get-oneastrologercompletedFailedChats-by-date-range',
  async (req, res) => {
    const { from, to, astrologerId, page = 1 } = req.query
    const limit = 10
    const skip = (page - 1) * limit

    try {
      // Validate required parameters
      if (!from || !to) {
        return res.status(400).json({
          success: false,
          message: "Both 'from' and 'to' date parameters are required",
        })
      }

      if (!astrologerId || !mongoose.Types.ObjectId.isValid(astrologerId)) {
        return res.status(400).json({
          success: false,
          message: 'Valid Astrologer ID is required',
        })
      }

      const parsedFrom = momentTime(from, 'DD-MM-YYYY', true)
      const parsedTo = momentTime(to, 'DD-MM-YYYY', true)

      if (!parsedFrom.isValid() || !parsedTo.isValid()) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format. Use 'DD-MM-YYYY'.",
        })
      }

      const astrologerObjectId = new mongoose.Types.ObjectId(astrologerId)
      const startOfDay = parsedFrom.tz('Asia/Kolkata').startOf('day').toDate()
      const endOfDay = parsedTo.tz('Asia/Kolkata').endOf('day').toDate()

      // Base query with both date range and astrologer filters
      const baseQuery = {
        type: 'chat',
        wallet_type: 'production',
        date: { $gte: startOfDay, $lte: endOfDay },
        astrologer: astrologerObjectId,
        $expr: { $lt: [{ $toDouble: '$session_time' }, 5] },
      }

      // Execute all queries in parallel for better performance
      const [
        completedFailedChats,
        totalFailedChats,
        totalFailedFreeChats,
        totalFailedPaidChats,
        paidChats,
      ] = await Promise.all([
        WalletTransactions.find(baseQuery)
          .populate('user', 'userName phone_number')
          .populate(
            'astrologer',
            'astrologerId astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt'
          )
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),

        WalletTransactions.countDocuments(baseQuery),

        WalletTransactions.countDocuments({
          ...baseQuery,
          amount: 'free chat',
        }),

        WalletTransactions.countDocuments({
          ...baseQuery,
          amount: { $ne: 'free chat' },
        }),

        WalletTransactions.find({ ...baseQuery, amount: { $ne: 'free chat' } }),
      ])

      // Calculate total failed amount
      const totalFailedAmount = paidChats.reduce((sum, chat) => {
        const cost =
          chat.amount === 'free chat'
            ? 0
            : Number(chat.amount) / chat.session_time
        return sum + (isNaN(cost) ? 0 : cost)
      }, 0)

      // Format the response data
      const updatedFailedChats = completedFailedChats.map((chat) => {
        const chatCost =
          chat.amount === 'free chat'
            ? 0
            : Number(chat.amount) / chat.session_time

        return {
          ...chat,
          chatCost,
          createdAt: chat.createdAt
            ? chat.createdAt.toLocaleString('en-GB', {
                timeZone: 'Asia/Kolkata',
                hour12: true,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
            : 'NA',
          updatedAt: chat.updatedAt
            ? chat.updatedAt.toLocaleString('en-GB', {
                timeZone: 'Asia/Kolkata',
                hour12: true,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
            : 'NA',
          // Maintain consistent structure
          user: {
            _id: chat.user?._id,
            userName: chat.user?.userName,
            phone_number: chat.user?.phone_number,
          },
          astrologer: {
            _id: chat.astrologer?._id,
            astrologerId: chat.astrologer?.astrologerId,
            astrologerName: chat.astrologer?.astrologerName,
            phone_number: chat.astrologer?.phone_number,
            status: chat.astrologer?.status,
            category: chat.astrologer?.category,
            known_languages: chat.astrologer?.known_languages || [],
            expertIn: chat.astrologer?.expertIn || [],
            experience: chat.astrologer?.experience,
            order_bookings: chat.astrologer?.order_bookings,
            cost: chat.astrologer?.cost,
            profile_photo: chat.astrologer?.profile_photo,
            wallet: chat.astrologer?.wallet,
            createdAt: chat.astrologer?.createdAt,
          },
        }
      })

      return res.status(200).json({
        success: true,
        dateRange: { from, to },
        astrologerId,
        CompletedFailedChats: updatedFailedChats,
        currentPage: Number(page),
        totalPages: Math.ceil(totalFailedChats / limit),
        totalFailedFreeChats,
        totalFailedPaidChats,
        totalFailedTransactions: totalFailedChats,
        totalFailedAmount,
        astrologerDetails: completedFailedChats[0]?.astrologer || null,
      })
    } catch (error) {
      console.error(
        'Error fetching completed failed chats by date range:',
        error
      )
      return res.status(500).json({
        success: false,
        message: 'Error fetching chats for the selected date range',
        error:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      })
    }
  }
)
//end update code

//new updated code branch:92-replace-astrologer-updated-code
router.get('/get-user-failed-chats', async (req, res) => {
  logger.info('Get user/astrologer failed chats API executed')
  try {
    const { userId, astrologerId, page = 1 } = req.query
    const limit = 10
    const skip = (parseInt(page) - 1) * limit

    if (!userId && !astrologerId) {
      return res.status(400).json({
        success: false,
        message: 'User ID or Astrologer ID is required',
      })
    }
    const filter = {
      type: 'chat',
      wallet_type: 'production',
      $expr: { $lt: [{ $toDouble: '$session_time' }, 5] },
    }

    if (userId) {
      filter.user = userId // Filter by userId
    }
    if (astrologerId) {
      filter.astrologer = astrologerId // Filter by astrologerId
    }

    const failedChats = await WalletTransactions.find(filter)
      .populate('user', 'userId userName phone_number')
      .populate(
        'astrologer',
        'astrologerId astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt currentTabVersion upi'
      )
      .sort({ updatedAt: -1 })
      .limit(limit)
      .skip(skip)

    const totalFailedChats = await WalletTransactions.find(filter)

    const totalFailedFreeChats = totalFailedChats.filter(
      (chat) => chat.amount === 'free chat'
    ).length
    const totalFailedPaidChats = totalFailedChats.filter(
      (chat) => chat.amount !== 'free chat'
    ).length
    const totalFailedAmount = totalFailedChats
      .filter((chat) => chat.amount !== 'free chat')
      .reduce((sum, chat) => sum + Number(chat.amount), 0)

    const updatedFailedChats = failedChats.map((chat) => {
      const chatCost =
        chat.amount === 'free chat' ? 'Free' : chat.amount / chat.session_time

      return {
        ...chat.toObject(),
        chatCost,
        createdAt: chat.createdAt
          ? chat.createdAt.toLocaleString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: true,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'NA',
        updatedAt: chat.updatedAt
          ? chat.updatedAt.toLocaleString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: true,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'NA',
      }
    })

    const totalFailedTransactions =
      await WalletTransactions.countDocuments(filter)

    logger.info('Success')
    return res.status(200).json({
      success: true,
      FailedChats: updatedFailedChats,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalFailedTransactions / limit),
      totalFailedFreeChats,
      totalFailedPaidChats,
      totalFailedTransactions,
      totalFailedAmount,
    })
  } catch (error) {
    logger.error('Error fetching user/astrologer failed chats', error)
    return res.status(500).json({
      message: 'Error fetching user/astrologer failed chats',
      error: error.message,
    })
  }
})

router.get('/get-user-failedChats-by-date', async (req, res) => {
  try {
    const { date: selectedDate, userId, astrologerId } = req.query
    const page = parseInt(req.query.page) || 1
    const limit = 10
    const skip = (page - 1) * limit

    if (!selectedDate || (!userId && !astrologerId)) {
      return res.status(400).json({
        success: false,
        message:
          'Date and either userId or astrologerId query parameter is required',
      })
    }

    const startOfDay = momentTime
      .tz(selectedDate, 'Asia/Kolkata')
      .startOf('day')
      .toDate()
    const endOfDay = momentTime
      .tz(selectedDate, 'Asia/Kolkata')
      .endOf('day')
      .toDate()

    // Dynamic filter based on userId or astrologerId
    let filter = {
      type: 'chat',
      wallet_type: 'production',
      date: { $gte: startOfDay, $lte: endOfDay },
      $expr: { $lt: [{ $toDouble: '$session_time' }, 5] },
    }

    if (userId) {
      filter.user = userId
    } else if (astrologerId) {
      filter.astrologer = astrologerId
    }

    const completedFailedChats = await WalletTransactions.find(filter)
      .populate('user', 'userName phone_number')
      .populate(
        'astrologer',
        'astrologerId astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt'
      )
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit)

    const totalFailedChats = await WalletTransactions.find(filter)

    const totalFailedAmount = totalFailedChats.reduce((sum, chat) => {
      const cost =
        chat.amount === 'free chat'
          ? 0
          : Number(chat.amount) / chat.session_time
      return sum + (isNaN(cost) ? 0 : cost)
    }, 0)

    const totalFailedFreeChats = totalFailedChats.filter(
      (chat) => chat.amount === 'free chat'
    ).length

    const totalFailedPaidChats = totalFailedChats.filter(
      (chat) => chat.amount !== 'free chat'
    ).length

    const updatedFailedChats = completedFailedChats.map((chat) => {
      const chatCost =
        chat.amount === 'free chat'
          ? 0
          : Number(chat.amount) / chat.session_time

      return {
        ...chat.toObject(),
        chatCost,
        createdAt: chat.createdAt
          ? chat.createdAt.toLocaleString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: true,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'NA',
        updatedAt: chat.updatedAt
          ? chat.updatedAt.toLocaleString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour12: true,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'NA',
      }
    })

    const totalFailedTransactions = totalFailedChats.length

    return res.status(200).json({
      success: true,
      SelectedDate: selectedDate,
      userId: userId || null,
      astrologerId: astrologerId || null,
      CompletedFailedChats: updatedFailedChats,
      currentPage: page,
      totalPages: Math.ceil(totalFailedTransactions / limit),
      totalFailedFreeChats: totalFailedFreeChats,
      totalFailedPaidChats: totalFailedPaidChats,
      totalFailedTransactions: totalFailedTransactions,
      totalFailedAmount: totalFailedAmount,
    })
  } catch (error) {
    return res.status(500).json({
      message: 'Error fetching chats for the selected date',
      error: error.message,
    })
  }
})

router.get('/get-OneUserFailed-chats', async (req, res) => {
  try {
    const { userId, page = 1 } = req.query
    const perPage = 10

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required',
      })
    }
    const objectIdUserId = mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : userId
    //console.log("Match Query:", { status: 'expired', type: 'chat', userId: objectIdUserId });
    const totalChats = await Queues.countDocuments({
      status: 'expired',
      type: 'chat',
      userId: objectIdUserId,
    })
    const skip = (parseInt(page) - 1) * perPage
    if (skip >= totalChats) {
      return res.status(200).json({
        success: true,
        failedChatsList: [],
        total: totalChats,
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalChats / perPage),
      })
    }
    const failedChats = await Queues.aggregate([
      { $match: { status: 'expired', type: 'chat', userId: objectIdUserId } },
      { $sort: { updatedAt: -1 } },
      { $skip: skip },
      { $limit: perPage },
      {
        $lookup: {
          from: 'astrologers',
          localField: 'astrologerId',
          foreignField: '_id',
          as: 'astrologerDetails',
        },
      },
      {
        $project: {
          _id: 1,
          userId: 1,
          userName: 1,
          from: 1,
          to: 1,
          type: 1,
          date: 1,
          time: 1,
          time_duration: 1,
          channelRoomId: 1,
          gender: 1,
          place_of_birth: 1,
          dob: 1,
          cost: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          astrologer: {
            _id: { $arrayElemAt: ['$astrologerDetails._id', 0] },
            astrologerName: {
              $arrayElemAt: ['$astrologerDetails.astrologerName', 0],
            },
            phone_number: {
              $arrayElemAt: ['$astrologerDetails.phone_number', 0],
            },
            status: { $arrayElemAt: ['$astrologerDetails.status', 0] },
            category: { $arrayElemAt: ['$astrologerDetails.category', 0] },
            known_languages: {
              $arrayElemAt: ['$astrologerDetails.known_languages', 0],
            },
            expertIn: { $arrayElemAt: ['$astrologerDetails.expertIn', 0] },
            experience: { $arrayElemAt: ['$astrologerDetails.experience', 0] },
            order_bookings: {
              $arrayElemAt: ['$astrologerDetails.order_bookings', 0],
            },
            cost: { $arrayElemAt: ['$astrologerDetails.cost', 0] },
            profile_photo: {
              $arrayElemAt: ['$astrologerDetails.profile_photo', 0],
            },
            wallet: { $arrayElemAt: ['$astrologerDetails.wallet', 0] },
            createdAt: { $arrayElemAt: ['$astrologerDetails.createdAt', 0] },
            currentTabVersion: {
              $arrayElemAt: ['$astrologerDetails.currentTabVersion', 0],
            },
            upi: {
              $arrayElemAt: ['$astrologerDetails.upi', 0],
            },
          },
        },
      },
    ])

    const formattedChats = failedChats.map((chat) => ({
      ...chat,
      updatedAt: momentTime(chat.updatedAt)
        .tz('Asia/Kolkata')
        .format('DD/MM/YYYY, hh:mm A'),
    }))

    return res.status(200).json({
      success: true,
      failedChatsList: formattedChats,
      total: totalChats,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalChats / perPage),
    })
  } catch (error) {
    return res.status(500).json({
      message: 'Error fetching Failed chats',
      error: error.message,
    })
  }
})

router.get('/get-OneUserFailed-chats-by-date', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const perPage = 10
    const { date, userId } = req.query

    // Validate required parameters
    if (!date || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Date and userId query parameters are required',
      })
    }

    // Convert "Asia/Kolkata" start and end of day to UTC
    const startOfDayIST = moment.tz(date, 'Asia/Kolkata').startOf('day')
    const endOfDayIST = moment.tz(date, 'Asia/Kolkata').endOf('day')
    const startOfDayUTC = startOfDayIST.utc().toDate()
    const endOfDayUTC = endOfDayIST.utc().toDate()

    // Convert userId to ObjectId if needed
    const objectIdUserId = mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : userId

    // Aggregation pipeline
    const failedChats = await Queues.aggregate([
      // Match failed chats by userId and date range
      {
        $match: {
          status: 'expired',
          type: 'chat',
          userId: objectIdUserId, // Ensure only the given user’s chats are fetched
          updatedAt: { $gte: startOfDayUTC, $lte: endOfDayUTC },
        },
      },

      { $sort: { updatedAt: -1 } },

      // Pagination
      { $skip: (page - 1) * perPage },
      { $limit: perPage },

      // Lookup astrologer details
      {
        $lookup: {
          from: 'astrologers',
          localField: 'astrologerId',
          foreignField: '_id',
          as: 'astrologerDetails',
        },
      },

      // Project required fields
      {
        $project: {
          _id: 1,
          userId: 1,
          userName: 1,
          from: 1,
          to: 1,
          type: 1,
          date: 1,
          time: 1,
          time_duration: 1,
          channelRoomId: 1,
          gender: 1,
          place_of_birth: 1,
          dob: 1,
          cost: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          astrologer: {
            _id: { $arrayElemAt: ['$astrologerDetails._id', 0] },
            astrologerName: {
              $arrayElemAt: ['$astrologerDetails.astrologerName', 0],
            },
            phone_number: {
              $arrayElemAt: ['$astrologerDetails.phone_number', 0],
            },
            status: { $arrayElemAt: ['$astrologerDetails.status', 0] },
            category: { $arrayElemAt: ['$astrologerDetails.category', 0] },
            known_languages: {
              $arrayElemAt: ['$astrologerDetails.known_languages', 0],
            },
            expertIn: { $arrayElemAt: ['$astrologerDetails.expertIn', 0] },
            experience: { $arrayElemAt: ['$astrologerDetails.experience', 0] },
            order_bookings: {
              $arrayElemAt: ['$astrologerDetails.order_bookings', 0],
            },
            cost: { $arrayElemAt: ['$astrologerDetails.cost', 0] },
            profile_photo: {
              $arrayElemAt: ['$astrologerDetails.profile_photo', 0],
            },
            wallet: { $arrayElemAt: ['$astrologerDetails.wallet', 0] },
            createdAt: { $arrayElemAt: ['$astrologerDetails.createdAt', 0] },
            isActive: { $arrayElemAt: ['$astrologerDetails.isActive', 0] },
          },
        },
      },
    ])

    // Format chats with "Asia/Kolkata" time
    const formattedChats = failedChats.map((chat) => ({
      ...chat,
      updatedAt: moment(chat.updatedAt)
        .tz('Asia/Kolkata')
        .format('DD/MM/YYYY, hh:mm A'),
    }))

    // Count total chats for the given date range and user
    const totalChats = await Queues.countDocuments({
      status: 'expired',
      type: 'chat',
      userId: objectIdUserId,
      updatedAt: { $gte: startOfDayUTC, $lte: endOfDayUTC },
    })

    // Return response
    return res.status(200).json({
      success: true,
      failedChatsList: formattedChats,
      total: totalChats,
      currentPage: page,
      totalPages: Math.ceil(totalChats / perPage),
    })
  } catch (error) {
    // Error handling
    return res.status(500).json({
      success: false,
      message: 'Error fetching failed chats by date',
      error: error.message,
    })
  }
})

router.get('/get-completed-failed-chats-by-astrologer', async (req, res) => {
  logger.info('get completed failed chats by astrologer api is executing')
  try {
    const { astrologerId, page = 1 } = req.query
    const limit = 10
    const skip = (page - 1) * limit

    // Validate astrologerId
    if (!astrologerId || !mongoose.Types.ObjectId.isValid(astrologerId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid Astrologer ID is required',
      })
    }

    const astrologerObjectId = new mongoose.Types.ObjectId(astrologerId)

    // Base query with astrologer filter
    const baseQuery = {
      type: 'chat',
      wallet_type: 'production',
      $expr: { $lt: [{ $toDouble: '$session_time' }, 5] },
      astrologer: astrologerObjectId,
    }

    // Execute all queries in parallel for better performance
    const [
      completedFailedChats,
      totalFailedChats,
      totalFailedFreeChats,
      totalFailedPaidChats,
      paidChats,
    ] = await Promise.all([
      WalletTransactions.find(baseQuery)
        .populate('user', 'userId userName phone_number')
        .populate(
          'astrologer',
          'astrologerName phone_number profile_photo category known_languages expertIn experience cost order_bookings status wallet createdAt'
        )
        .sort({ updatedAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),

      WalletTransactions.countDocuments(baseQuery),

      WalletTransactions.countDocuments({ ...baseQuery, amount: 'free chat' }),

      WalletTransactions.countDocuments({
        ...baseQuery,
        amount: { $ne: 'free chat' },
      }),

      WalletTransactions.find({ ...baseQuery, amount: { $ne: 'free chat' } }),
    ])

    // Calculate total failed amount
    const totalFailedAmount = paidChats.reduce(
      (sum, chat) => sum + Number(chat.amount),
      0
    )

    // Format the response data
    const updatedFailedChats = await Promise.all(
      completedFailedChats.map(async (chat) => {
        const chatCost =
          chat.amount === 'free chat'
            ? 'Free'
            : (chat.amount / chat.session_time).toFixed(2)

        // Find associated chatroom if needed
        const chatroom = await Chatroom.findOne({
          userId: chat.user?._id,
          astrologerId: chat.astrologer?._id,
        })

        // Format dates
        const formatDate = (date) => {
          if (!date) return 'NA'
          return date.toLocaleString('en-GB', {
            timeZone: 'Asia/Kolkata',
            hour12: true,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        }

        return {
          ...chat,
          chatCost,
          chatroomId: chatroom?._id || null,
          createdAt: formatDate(chat.createdAt),
          updatedAt: formatDate(chat.updatedAt),
          // Ensure consistent field names
          user: {
            _id: chat.user?._id,
            userId: chat.user?.userId,
            userName: chat.user?.userName,
            phone_number: chat.user?.phone_number,
          },
          astrologer: {
            _id: chat.astrologer?._id,
            astrologerId: chat.astrologer?.astrologerId,
            astrologerName: chat.astrologer?.astrologerName,
            phone_number: chat.astrologer?.phone_number,
            profile_photo: chat.astrologer?.profile_photo || '',
            category: chat.astrologer?.category,
            known_languages: chat.astrologer?.known_languages || [],
            expertIn: chat.astrologer?.expertIn || [],
            experience: chat.astrologer?.experience || '0 years',
            cost: chat.astrologer?.cost || '0',
            order_bookings: chat.astrologer?.order_bookings || 0,
            status: chat.astrologer?.status || 'inactive',
            wallet: chat.astrologer?.wallet || 0,
            createdAt: chat.astrologer?.createdAt,
          },
        }
      })
    )

    logger.info('Successfully fetched completed failed chats for astrologer')
    return res.status(200).json({
      success: true,
      CompletedFailedChats: updatedFailedChats,
      currentPage: Number(page),
      totalPages: Math.ceil(totalFailedChats / limit),
      totalFailedFreeChats,
      totalFailedPaidChats,
      totalFailedTransactions: totalFailedChats,
      totalFailedAmount,
      astrologerDetails: completedFailedChats[0]?.astrologer || null,
    })
  } catch (error) {
    logger.error('Error fetching completed failed chats by astrologer:', error)
    return res.status(500).json({
      success: false,
      message: 'Error fetching completed failed chats',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    })
  }
})

// get-failed-chats-by-oneastrologerfailedreason

module.exports = router
