const express = require('express')
const router = express.Router()
const Chatroom = require('../models/Chatroom')
// const Message = require("../models/Message");
const User = require('../models/User')
const Astrologer = require('../models/Astrologer')
const mongoose = require('mongoose')
const moment = require('moment')
const logger = require('../Logger')
const WalletTransactions = require('../models/WalletTransactions')

const AWS = require('aws-sdk')
const zlib = require('zlib')

AWS.config.update({
  accessKeyId: process.env.S3_ACCESS_KEY_ID_OLD,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY_OLD,
  region: process.env.S3_REGION_OLD,
})

const s3 = new AWS.S3()

router.post('/createChatroom', async (req, res) => {
  logger.info('Execute Chat Room api')
  const { userId, astrologerId } = req.body

  try {
    let chatroom = await Chatroom.findOne({
      user: userId,
      astrologer: astrologerId,
    })

    if (!chatroom) {
      chatroom = new Chatroom({
        user: userId,
        astrologer: astrologerId,
        chatroomId: getRoomId(userId, astrologerId),
      })
      await chatroom.save()
      logger.debug('New chatroom created:', chatroom)
    } else {
      logger.debug('Chatroom already exists:', chatroom)
    }
    logger.info('chatroom success')
    return res.status(200).json(chatroom)
  } catch (error) {
    logger.error('Error creating or fetching chatroom:', error)
    return res
      .status(500)
      .json({ error: 'Error creating or fetching chatroom' })
  }
})
router.get('/get-chat-rooms', async (req, res) => {
  logger.info('get chat room API is executed')
  try {
    const page = parseInt(req.query.page) || 1
    const limit = 10 // Number of chat rooms per page
    const skip = (page - 1) * limit

    const chatRooms = await Chatroom.find({})
      .sort({ updatedAt: -1 })
      .populate('user', 'userId userName phone_number')
      .populate(
        'astrologer',
        'astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt currentTabVersion upi'
      )
      .skip(skip)
      .limit(limit)

    // Total chat rooms count
    const totalChatRooms = await Chatroom.countDocuments()
    const totalPages = Math.ceil(totalChatRooms / limit)

    // Process chat rooms for response
    const processedChatRooms = chatRooms.map((room) => ({
      _id: room._id,
      chatroomId: room?.chatroomId,
      user: room.user
        ? {
            userId: room.user._id || room.user.userId || 'NA',
            userName: room.user.userName || 'NA',
            phone_number: room.user.phone_number || 'NA',
          }
        : 'NA',
      astrologer: room.astrologer
        ? {
            _id: room.astrologer._id,
            astrologerName: room.astrologer.astrologerName || 'NA',
            phone_number: room.astrologer.phone_number || 'NA',
            status: room.astrologer.status || 'NA',
            category: room.astrologer.category || 'NA',
            known_languages: room.astrologer.known_languages || 'NA',
            expertIn: room.astrologer.expertIn || 'NA',
            experience: room.astrologer.experience || 'NA',
            order_bookings: room.astrologer.order_bookings || 'NA',
            cost: room.astrologer.cost || 'NA',
            profile_photo: room.astrologer.profile_photo || 'NA',
            wallet: room.astrologer.wallet || 'NA',
            createdAt: room.astrologer.createdAt || 'NA',
            currentTabVersion: room.astrologer.currentTabVersion || 'NA', // Added field
            upi: room.astrologer.upi || 'NA', // Added field
          }
        : 'NA',
      messageCount: room.messages.length, // Assuming messages is an array
      createdAt: room.createdAt
        ? room.createdAt.toLocaleString('en-GB', {
            timeZone: 'Asia/Kolkata',
            hour12: true,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'NA',
      updatedAt: room.updatedAt
        ? room.updatedAt.toLocaleString('en-GB', {
            timeZone: 'Asia/Kolkata',
            hour12: true,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'NA',
    }))

    // Sending response with pagination
    logger.info('Chat rooms fetched successfully')
    return res.status(200).json({
      success: true,
      chatRooms: processedChatRooms,
      currentPage: page,
      totalPages: totalPages,
      totalChatRooms: totalChatRooms,
    })
  } catch (error) {
    logger.error('Error fetching chat rooms:', error)
    return res.status(500).json({
      success: false,
      message: 'Error fetching chat rooms',
      error: error.message,
    })
  }
})

router.post('/get-chat-rooms-by-user', async (req, res) => {
  logger.info('Get chat rooms by user API executed')

  try {
    const { userId } = req.body

    if (!userId) {
      logger.info('User ID is required.')
      return res.status(400).json({ error: 'User ID is required.' })
    }

    const page = parseInt(req.query.page) || 1
    const limit = 10
    const skip = (page - 1) * limit

    const chatRooms = await Chatroom.find({ user: userId })
      .sort({ updatedAt: -1 })
      .populate('user', '_id userName phone_number')
      .populate(
        'astrologer',
        '_id astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt currentTabVersion upi'
      )
      .skip(skip)
      .limit(limit)

    const totalChatRooms = await Chatroom.countDocuments({ user: userId })
    const totalPages = Math.ceil(totalChatRooms / limit)

    const processedChatRooms = await Promise.all(
      chatRooms?.map(async (room) => {
        const findDateWithWalletTransaction = await WalletTransactions.findOne({
          astrologer: room?.astrologer?._id,
          user: userId,
          type: 'chat',
        })
          .select('updatedAt')
          .sort({ updatedAt: -1 })
          .limit(1)

        const formattedDate = findDateWithWalletTransaction?.updatedAt
          ? new Date(findDateWithWalletTransaction.updatedAt).toLocaleString(
              'en-GB',
              {
                timeZone: 'Asia/Kolkata',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              }
            )
          : 'NA'
        return {
          _id: room._id,
          chatroomId: room?.chatroomId || 'NA',
          user: room.user
            ? {
                _id: room.user?._id || 'NA',
                userName: room.user?.userName || 'NA',
                phone_number: room.user?.phone_number || 'NA',
              }
            : 'NA',
          astrologer: room.astrologer
            ? {
                _id: room.astrologer?._id || 'NA',
                astrologerName: room.astrologer?.astrologerName || 'NA',
                phone_number: room.astrologer?.phone_number || 'NA',
                status: room.astrologer?.status || 'NA',
                category: room.astrologer?.category || 'NA',
                known_languages: room.astrologer?.known_languages || 'NA',
                expertIn: room.astrologer?.expertIn || 'NA',
                experience: room.astrologer?.experience || 'NA',
                order_bookings: room.astrologer?.order_bookings || 0,
                cost: room.astrologer?.cost || 0,
                profile_photo: room.astrologer?.profile_photo || 'NA',
                wallet: room.astrologer?.wallet || 'NA',
                createdAt: room.astrologer?.createdAt || 'NA',
                currentTabVersion: room.astrologer.currentTabVersion || 'NA', // Added field
                upi: room.astrologer.upi || 'NA', // Added field
              }
            : 'NA',
          messageCount: room?.messages?.length || 0,
          createdAt: room.createdAt
            ? room.createdAt.toLocaleString('en-GB', {
                timeZone: 'Asia/Kolkata',
                hour12: true,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
            : 'NA',
          updatedAt: formattedDate || 'NA',
        }
      })
    )

    logger.info('Success')
    return res.status(200).json({
      success: true,
      chatRooms: processedChatRooms,
      currentPage: page,
      totalPages: totalPages,
      totalChatRooms: totalChatRooms,
    })
  } catch (error) {
    logger.error('Error fetching chat rooms by user:', error)
    return res.status(500).json({ error: 'Error fetching chat rooms by user.' })
  }
})

router.post('/get-chat-rooms-by-astrologer', async (req, res) => {
  logger.info('Get chat rooms by astrologer API executed')

  try {
    const { astrologerId } = req.body

    if (!astrologerId) {
      logger.info('Astrologer ID is required')
      return res.status(400).json({ error: 'Astrologer ID is required.' })
    }

    const page = parseInt(req.query.page) || 1
    const limit = 10
    const skip = (page - 1) * limit

    const chatRooms = await Chatroom.find({ astrologer: astrologerId })
      .sort({ updatedAt: -1 })
      .populate('user', '_id userId userName phone_number')
      .populate('astrologer', '_id astrologerName phone_number')
      .skip(skip)
      .limit(limit)

    const totalChatRooms = await Chatroom.countDocuments({
      astrologer: astrologerId,
    })
    const totalPages = Math.ceil(totalChatRooms / limit)

    const processedChatRooms = await Promise.all(
      chatRooms?.map(async (room) => {
        const findDateWithWalletTransaction = await WalletTransactions.findOne({
          astrologer: astrologerId,
          user: room?.user?._id,
          type: 'chat',
        })
          .select('updatedAt')
          .sort({ updatedAt: -1 })
          .limit(1)

        // console.log("line 285", findDateWithWalletTransaction, room?.user?._id)

        const formattedDate = findDateWithWalletTransaction?.updatedAt
          ? new Date(findDateWithWalletTransaction.updatedAt).toLocaleString(
              'en-GB',
              {
                timeZone: 'Asia/Kolkata',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              }
            )
          : 'NA'
        return {
          _id: room._id,
          chatroomId: room?.chatroomId,
          user: room.user
            ? {
                userId: room.user._id || room.user.userId || 'NA',
                userName: room.user?.userName || 'NA',
                phone_number: room.user?.phone_number || 'NA',
              }
            : 'NA',
          astrologer: room.astrologer
            ? {
                astrologerId: room.astrologer?._id || 'NA',
                astrologerName: room.astrologer?.astrologerName || 'NA',
                phone_number: room.astrologer?.phone_number || 'NA',
              }
            : 'NA',
          messageCount: room?.messages.length,
          createdAt: room.createdAt
            ? room.createdAt.toLocaleString('en-GB', {
                timeZone: 'Asia/Kolkata',
                hour12: true,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
            : 'NA',
          updatedAt: formattedDate || 'NA',
        }
      })
    )
    logger.info('Success')
    return res.status(200).json({
      success: true,
      chatRooms: processedChatRooms,
      currentPage: page,
      totalPages: totalPages,
      totalChatRooms: totalChatRooms,
    })
  } catch (error) {
    logger.error('Error fetching chat rooms by astrologer:', error)
    return res
      .status(500)
      .json({ error: 'Error fetching chat rooms by astrologer.' })
  }
})

router.get('/search-chat-rooms', async (req, res) => {
  logger.info('Search chat rooms api is execute')
  try {
    const { search, page = 1 } = req.query
    const perPage = 10

    const aggregationPipeline = [
      {
        $lookup: {
          from: 'users', // Collection name for User
          localField: 'user',
          foreignField: '_id',
          as: 'user',
        },
      },
      {
        $lookup: {
          from: 'astrologers', // Collection name for Astrologer
          localField: 'astrologer',
          foreignField: '_id',
          as: 'astrologer',
        },
      },

      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $unwind: {
          path: '$astrologer',
          preserveNullAndEmptyArrays: true,
        },
      },
    ]

    if (search) {
      aggregationPipeline.push({
        $match: {
          $or: [
            { 'user.userName': { $regex: search, $options: 'i' } },
            {
              'astrologer.astrologerName': {
                $regex: search,
                $options: 'i',
              },
            },
            {
              'user.phone_number': {
                $regex: search,
                $options: 'i',
              },
            },
            {
              'astrologer.phone_number': {
                $regex: search,
                $options: 'i',
              },
            },
          ],
        },
      })
    }
    // Sort the results by creation date
    aggregationPipeline.push({ $sort: { createdAt: -1 } })

    // Pagination: Calculate skip and limit
    const skip = (parseInt(page) - 1) * perPage
    aggregationPipeline.push({ $skip: skip }, { $limit: perPage })

    // Get paginated chat rooms
    const chatRooms = await Chatroom.aggregate(aggregationPipeline)

    // Get the total count for pagination info
    const totalCountPipeline = [...aggregationPipeline]
    totalCountPipeline.pop() // Remove $skip
    totalCountPipeline.pop() // Remove $limit
    totalCountPipeline.push({ $count: 'total' })
    const totalCountResult = await Chatroom.aggregate(totalCountPipeline)
    const total = totalCountResult.length > 0 ? totalCountResult[0].total : 0

    // Process chat rooms
    const processedChatRooms = chatRooms.map((room) => ({
      _id: room._id,
      chatroomId: room?.chatroomId,
      user: room.user
        ? {
            userId: room.user._id || room.user.userId || 'NA',
            userName: room.user?.userName || 'NA',
            phone_number: room.user?.phone_number || 'NA',
          }
        : 'NA',
      astrologer: room.astrologer
        ? {
            _id: room.astrologer._id,
            astrologerName: room.astrologer?.astrologerName || 'NA',
            phone_number: room.astrologer?.phone_number || 'NA',
            status: room.astrologer?.status || 'NA',
            category: room.astrologer?.category || 'NA',
            known_languages: room.astrologer?.known_languages || 'NA',
            expertIn: room.astrologer?.expertIn || 'NA',
            experience: room.astrologer?.experience || 'NA',
            order_bookings: room.astrologer?.order_bookings || 'NA',
            cost: room.astrologer?.cost || 'NA',
            profile_photo: room.astrologer?.profile_photo || 'NA',
          }
        : 'NA',
      messageCount: room.messages ? room.messages.length : 0,
      createdAt: room.createdAt
        ? room.createdAt.toLocaleString('en-GB', {
            timeZone: 'Asia/Kolkata',
            hour12: true,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'NA',
      updatedAt: room.updatedAt
        ? room.updatedAt.toLocaleString('en-GB', {
            timeZone: 'Asia/Kolkata',
            hour12: true,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'NA',
    }))
    // Send response with the found chat rooms
    logger.info('ProcessedChatRooms is success')
    return res.status(200).json({
      success: true,
      chatRooms: processedChatRooms,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / perPage),
        totalItems: total,
      },
    })
  } catch (error) {
    logger.error('Error searching chat rooms:', error)
    return res.status(500).json({
      error: 'Error searching chat rooms',
    })
  }
})

// router.get("/getAllMessages",async(req,res)=>{
//     try{
//         const messages = await Message.find()
//         return res.status(200).json({
//             success: true,
//             messages: messages});

//     }catch(error){
//         return res.status(500).json({
//             error: "Error fetching messages"
//         });
//     }
// })
const sanitizeObjectId = (id) => {
  const cleanId = id?.replace(/^"|"$/g, '').replace(/^\\|"$/g, '')
  return mongoose.Types.ObjectId.isValid(cleanId) ? cleanId : null
}
// router.get('/messages/:chatroomId', async (req, res) => {
//   logger.info('Message and  ChatroomId Is Execute')
//   const { chatroomId } = req.params

//   try {
//     const chatroom = await Chatroom.findOne({ chatroomId: chatroomId })
//       .populate('user', 'userName')
//       .populate('astrologer', 'astrologerName')

//     if (!chatroom) {
//       logger.info('Chatroom not found')
//       return res.status(404).json({
//         success: false,
//         message: 'Chatroom not found',
//       })
//     }
//     // Process and format messages
//     const populatedMessages = await Promise.all(
//       chatroom.messages.map(async (message) => {
//         const cleanSenderId = sanitizeObjectId(message.senderId)
//         let senderName = 'Unknown Sender'

//         if (cleanSenderId) {
//           const user = await User.findById(cleanSenderId, 'userName')
//           if (user) {
//             senderName = user.userName
//           } else {
//             const astrologer = await Astrologer.findById(
//               cleanSenderId,
//               'astrologerName'
//             )
//             if (astrologer) {
//               senderName = astrologer.astrologerName
//             }
//           }
//         } else {
//           senderName = 'Invalid Sender ID'
//         }

//         return {
//           ...message._doc,
//           senderName,
//           createdAt: message.createdAt,
//         }
//       })
//     )

//     // Format and group messages by date
//     const formattedMessages = []
//     let previousDate = null

//     populatedMessages.forEach((message) => {
//       const messageDate = moment(message.createdAt)
//       const formattedDate = messageDate.format('YYYY-MM-DD')
//       const today = moment().startOf('day')
//       const yesterday = moment().subtract(1, 'days').startOf('day')

//       let dateLabel = null
//       if (formattedDate !== previousDate) {
//         // Determine if the date is "Today", "Yesterday", or a specific date
//         if (messageDate.isSame(today, 'day')) {
//           dateLabel = 'Today'
//         } else if (messageDate.isSame(yesterday, 'day')) {
//           dateLabel = 'Yesterday'
//         } else {
//           dateLabel = messageDate.format('MMMM Do, YYYY')
//         }

//         // Only set previousDate if it's a new date
//         previousDate = formattedDate

//         // Add the message with the date label
//         formattedMessages.push({
//           ...message,
//           date: dateLabel,
//         })
//       } else {
//         // Add the message without a date label
//         formattedMessages.push({
//           ...message,
//           date: '', // Empty date for subsequent messages on the same day
//         })
//       }
//     })
//     logger.info('chatroom success')
//     return res.status(200).json({
//       success: true,
//       chatroom: {
//         chatroomId: chatroom._id,
//         chatroomName: chatroom.chatroomName,
//         user: {
//           userName: chatroom.user.userName,
//         },
//         astrologer: {
//           astrologerName: chatroom.astrologer.astrologerName,
//         },
//         messages: formattedMessages,
//       },
//     })
//   } catch (error) {
//     logger.error('Error fetching messages:', error)
//     return res.status(500).json({
//       success: false,
//       error: 'Error fetching messages',
//     })
//   }
// })
router.get('/messages/:chatroomId', async (req, res) => {
  const { chatroomId } = req.params

  try {
    logger.info(`Fetching messages for chatroom: ${chatroomId}`)

    // Find chatroom and populate basic user/astrologer info
    const chatroom = await Chatroom.findOne({ chatroomId })
      .populate('user', 'userName')
      .populate('astrologer', 'astrologerName')
      .lean()

    if (!chatroom) {
      logger.warn(`Chatroom not found: ${chatroomId}`)
      return res.status(404).json({
        success: false,
        message: 'Chatroom not found',
      })
    }

    if (!chatroom.messages || chatroom.messages.length === 0) {
      logger.info(`No messages found in chatroom: ${chatroomId}`)
      return res.status(200).json({
        success: true,
        chatroom: {
          chatroomId: chatroom._id,
          chatroomName: chatroom.chatroomName,
          user: {
            userName: chatroom.user?.userName || 'Unknown User',
          },
          astrologer: {
            astrologerName:
              chatroom.astrologer?.astrologerName || 'Unknown Astrologer',
          },
          messages: [],
        },
      })
    }

    // Sort messages by date (newest first)
    const sortedMessages = [...chatroom.messages].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    )

    // Find the most recent message date
    const latestMessageDate = moment(sortedMessages[0].createdAt).startOf('day')

    // Calculate the 3-day window (current day and previous 2 days)
    const startDate = moment(latestMessageDate)
      .subtract(2, 'days')
      .startOf('day')
    const endDate = moment(latestMessageDate).endOf('day')

    // Filter messages within this 3-day window
    const filteredMessages = sortedMessages.filter((message) => {
      const messageDate = moment(message.createdAt)
      return messageDate.isBetween(startDate, endDate, null, '[]') // inclusive
    })

    // Batch fetch all user/astrologer names for the filtered messages
    const senderIds = [
      ...new Set(filteredMessages.map((msg) => msg.senderId?.toString())),
    ].filter((id) => id)

    const [users, astrologers] = await Promise.all([
      User.find({ _id: { $in: senderIds } }, 'userName').lean(),
      Astrologer.find({ _id: { $in: senderIds } }, 'astrologerName').lean(),
    ])

    const senderMap = new Map()
    users.forEach((user) => senderMap.set(user._id.toString(), user.userName))
    astrologers.forEach((astro) =>
      senderMap.set(astro._id.toString(), astro.astrologerName)
    )

    // Process messages with sender names
    const populatedMessages = filteredMessages.map((message) => {
      const cleanSenderId = sanitizeObjectId(message.senderId)
      const senderName = cleanSenderId
        ? senderMap.get(cleanSenderId.toString()) || 'Unknown Sender'
        : 'Invalid Sender ID'

      return {
        ...message,
        senderName,
        createdAt: message.createdAt,
      }
    })

    // Sort messages chronologically (oldest first) for display
    populatedMessages.sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
    )

    // Format and group messages by date
    const formattedMessages = []
    let previousDate = null

    populatedMessages.forEach((message) => {
      const messageDate = moment(message.createdAt)
      const formattedDate = messageDate.format('YYYY-MM-DD')

      let dateLabel = ''
      if (formattedDate !== previousDate) {
        const today = moment().startOf('day')
        const yesterday = moment().subtract(1, 'days').startOf('day')

        if (messageDate.isSame(today, 'day')) {
          dateLabel = 'Today'
        } else if (messageDate.isSame(yesterday, 'day')) {
          dateLabel = 'Yesterday'
        } else {
          dateLabel = messageDate.format('MMMM Do, YYYY')
        }

        previousDate = formattedDate
      }

      formattedMessages.push({
        ...message,
        date: dateLabel,
      })
    })

    logger.info(`Successfully fetched messages for chatroom: ${chatroomId}`)
    return res.status(200).json({
      success: true,
      chatroom: {
        chatroomId: chatroom._id,
        chatroomName: chatroom.chatroomName,
        user: {
          userName: chatroom.user?.userName || 'Unknown User',
        },
        astrologer: {
          astrologerName:
            chatroom.astrologer?.astrologerName || 'Unknown Astrologer',
        },
        messages: formattedMessages,
      },
    })
  } catch (error) {
    logger.error(`Error fetching messages for chatroom ${chatroomId}:`, error)
    return res.status(500).json({
      success: false,
      error: 'Internal server error while fetching messages',
    })
  }
})

router.post('/messagesFromAws', async (req, res) => {
  logger.info('Fetching messages from AWS S3')

  const { chatroomId } = req.body

  try {
    const chatroom = await Chatroom.findOne({ chatroomId })
      .select('msgsToAwsS3BucketUrl user astrologer chatroomName')
      .populate('user', 'userName')
      .populate('astrologer', 'astrologerName')

    if (!chatroom) {
      logger.info('Chatroom not found')
      return res
        .status(404)
        .json({ success: false, message: 'Chatroom not found' })
    }

    const fileName = chatroom?.msgsToAwsS3BucketUrl

    let jsonData
    try {
      const s3Data = await s3
        .getObject({ Bucket: 'astrologer-images', Key: fileName })
        .promise()
      jsonData = JSON.parse(zlib.gunzipSync(s3Data.Body).toString('utf-8'))
    } catch (err) {
      logger.error('Error retrieving messages from S3:', err)
      return res.status(500).json({
        success: false,
        message: 'Error retrieving messages from AWS S3',
      })
    }

    const messages = jsonData?.messages || []

    const senderIds = [
      ...new Set(messages.map((msg) => sanitizeObjectId(msg?.senderId))),
    ]

    const users = await User.find({ _id: { $in: senderIds } }).select(
      'userName'
    )
    const astrologers = await Astrologer.find({
      _id: { $in: senderIds },
    }).select('astrologerName')

    const senderMap = {}
    users.forEach((user) => (senderMap[user._id] = user.userName))
    astrologers.forEach(
      (astrologer) => (senderMap[astrologer._id] = astrologer.astrologerName)
    )

    const populatedMessages = messages.map((message) => ({
      ...message,
      senderName: senderMap[message?.senderId] || 'Unknown Sender',
      createdAt: message?.createdAt,
    }))

    let previousDate = null
    const formattedMessages = populatedMessages.map((message) => {
      const messageDate = moment(message?.createdAt)
      const formattedDate = messageDate.format('YYYY-MM-DD')
      const today = moment().startOf('day')
      const yesterday = moment().subtract(1, 'days').startOf('day')

      let dateLabel = ''
      if (formattedDate !== previousDate) {
        if (messageDate.isSame(today, 'day')) {
          dateLabel = 'Today'
        } else if (messageDate.isSame(yesterday, 'day')) {
          dateLabel = 'Yesterday'
        } else {
          dateLabel = messageDate.format('MMMM Do, YYYY')
        }
        previousDate = formattedDate
      }

      return { ...message, date: dateLabel }
    })

    logger.info('Successfully fetched chatroom messages')

    return res.status(200).json({
      success: true,
      chatroom: {
        chatroomId,
        chatroomName: chatroom?.chatroomName,
        user: { userName: chatroom?.user?.userName },
        astrologer: { astrologerName: chatroom?.astrologer?.astrologerName },
        messages: formattedMessages,
      },
    })
  } catch (error) {
    logger.error('Error fetching messages:', error)
    return res
      .status(500)
      .json({ success: false, message: 'Error fetching messages' })
  }
})

function getRoomId(userId1, userId2) {
  const ids = [userId1, userId2]
  ids.sort()
  return ids.join('_')
}

router.post('/ChatHistory', async (req, res) => {
  logger.info('ChatHistory api is execute')
  const userId = req.body.id

  try {
    const chatrooms = await Chatroom.find({
      $or: [{ user: userId }],
    })
      .populate('user', 'userName')
      .populate('astrologer', 'astrologerName')

    if (!chatrooms || chatrooms.length === 0) {
      logger.info('No chatrooms found for this user')
      return res.status(404).json({
        success: false,
        message: 'No chatrooms found for this user',
      })
    }

    const response = await Promise.all(
      chatrooms.map(async (chatroom) => {
        const astrologerId = chatroom.astrologer?._id
        const astrologer = await Astrologer.findById(astrologerId)

        const messages = chatroom.messages.map((msg) => ({
          senderId: msg.senderId,
          message: msg.message,
          type: msg.type,
          createdAt: msg.createdAt,
        }))

        return {
          astrologerId: astrologerId,
          astrologerName: astrologer?.astrologerName,
          astrologerCost: astrologer?.cost,
          astrologerPhoneNumber: astrologer?.phone_number,
          astrologerProfilePhoto: astrologer?.profile_photo,
          messages: messages,
        }
      })
    )
    logger.info('Success Response')
    return res.status(200).json({
      success: true,
      status: 200,
      data: response,
    })
  } catch (error) {
    // logger.error("Error fetching chat history:", error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: `server error ${error}`,
    })
  }
})

router.get('/get-chat-rooms-by-date', async (req, res) => {
  logger.info('Get chat rooms by date api is executing')
  try {
    const { date } = req.query

    if (!date) {
      logger.info('Date is required for filtering.')
      return res.status(400).json({
        error: 'Date is required for filtering.',
      })
    }

    // Create new Date objects for start and end without modifying the original
    const selectedDate = new Date(date)
    const startOfDay = new Date(selectedDate)
    startOfDay.setHours(0, 0, 0, 0)

    const endOfDay = new Date(selectedDate)
    endOfDay.setHours(23, 59, 59, 999)

    // Validate the date
    if (isNaN(startOfDay.getTime())) {
      logger.info('Invalid date format provided.')
      return res.status(400).json({
        error: 'Invalid date format. Please use YYYY-MM-DD format.',
      })
    }

    const page = parseInt(req.query.page) || 1
    const limit = 10 // Number of chat rooms per page
    const skip = (page - 1) * limit

    // Fetch chat rooms based on the date filter with pagination
    const chatRoomsQuery = {
      updatedAt: { $gte: startOfDay, $lte: endOfDay }, // Filter by the selected date
    }

    const [chatRooms, totalChatRooms] = await Promise.all([
      Chatroom.find(chatRoomsQuery)
        .sort({ updatedAt: -1 })
        .populate('user', 'userId userName phone_number')
        .populate(
          'astrologer',
          'astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt'
        )
        .skip(skip)
        .limit(limit),
      Chatroom.countDocuments(chatRoomsQuery),
    ])

    const totalPages = Math.ceil(totalChatRooms / limit)

    // Process chat rooms for the response
    const processedChatRooms = chatRooms.map((room) => ({
      _id: room?._id,
      chatroomId: room?.chatroomId,
      user: room.user
        ? {
            userId: room.user._id || room.user.userId || 'NA',
            userName: room.user.userName || 'NA',
            phone_number: room.user.phone_number || 'NA',
          }
        : 'NA',
      astrologer: room.astrologer
        ? {
            _id: room.astrologer._id,
            astrologerName: room.astrologer?.astrologerName || 'NA',
            phone_number: room.astrologer?.phone_number || 'NA',
            status: room.astrologer.status || 'NA',
            category: room.astrologer.category || 'NA',
            known_languages: room.astrologer.known_languages || 'NA',
            expertIn: room.astrologer.expertIn || 'NA',
            experience: room.astrologer.experience || 'NA',
            order_bookings: room.astrologer.order_bookings || 'NA',
            cost: room.astrologer.cost || 'NA',
            profile_photo: room.astrologer.profile_photo || 'NA',
            wallet: room.astrologer.wallet || 'NA',
            createdAt: room.astrologer.createdAt || 'NA',
          }
        : 'NA',
      messageCount: room.messages.length,
      createdAt: room.createdAt
        ? room.createdAt.toLocaleString('en-GB', {
            timeZone: 'Asia/Kolkata',
            hour12: true,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'NA',
      updatedAt: room.updatedAt
        ? room.updatedAt.toLocaleString('en-GB', {
            timeZone: 'Asia/Kolkata',
            hour12: true,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'NA',
    }))

    // Send response with pagination information and filtered chat rooms
    logger.info('Successfully fetched chat rooms by date')
    return res.status(200).json({
      success: true,
      chatRooms: processedChatRooms,
      currentPage: page,
      totalPages: totalPages,
      totalChatRooms: totalChatRooms,
      dateFilter: {
        start: startOfDay.toISOString(),
        end: endOfDay.toISOString(),
      },
    })
  } catch (error) {
    logger.error('Error fetching chat rooms by date:', error)
    return res.status(500).json({
      error: 'Error fetching chat rooms by date',
      details: error.message,
    })
  }
})

module.exports = router
