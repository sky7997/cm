var express = require('express')
var router = express.Router()
const Transaction = require('../models/Transaction')
const moment = require('moment-timezone')
const User = require('../models/User')
const logger = require('../Logger')
const Coupon = require('../models/Coupons');
////

// GET paid users with pagination
router.get('/paid-users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    let query = {};
    let todayInstalledCount;
    if (req.query.date) {
      const selectedDate = moment(req.query.date);
      if (selectedDate.isAfter(moment(), 'day')) {
        todayInstalledCount = 0;
      } else {
        const startOfDay = selectedDate.startOf('day').toDate();
        const endOfDay = selectedDate.endOf('day').toDate();
        query.createdAt = { $gte: startOfDay, $lte: endOfDay };

        todayInstalledCount = await User.countDocuments({
          createdAt: { $gte: startOfDay, $lte: endOfDay },
        });
      }
    } else {
      const selectedDate = moment();
      const startOfDay = selectedDate.startOf('day').toDate();
      const endOfDay = selectedDate.endOf('day').toDate();
      todayInstalledCount = await User.countDocuments({
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      });
    }

    // Only users who made successful payments
    const successfulTransactions = await Transaction.aggregate([
      { $match: { status: 'success' } },
      { $group: { _id: '$user' } }
    ]);
    const paidUserIds = successfulTransactions.map(t => t._id);

    const users = await User.find({ _id: { $in: paidUserIds }, ...query })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit);

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No paid users found',
        todayInstalled: todayInstalledCount,
      });
    }

    const usersWithWalletAndPayment = await Promise.all(
      users.map(async (user) => {
        const [transactions, claimedCoupons] = await Promise.all([
          Transaction.find({ user: user._id, status: 'success' }),
          Coupon.find({ user: user._id, status: "claimed" }),
        ]);

        const totalAmount = transactions.reduce(
          (sum, t) => sum + (t.amount || 0),
          0
        );

        const couponCount = claimedCoupons.length;
        const couponSavings = claimedCoupons.reduce(
          (sum, c) => sum + parseFloat(c.amount || 0),
          0
        );

        return {
          ...user._doc,
          totalPayment: totalAmount,
          wallet: user.wallet || 0,
          couponsUsed: couponCount,
          couponSavings: couponSavings,
          transactionCount: transactions.length,
          lastPayment: transactions[0]?.createdAt || null,
        };
      })
    );

    usersWithWalletAndPayment.sort((a, b) => b.wallet - a.wallet);

    const totalUsers = paidUserIds.length;

    return res.status(200).json({
      success: true,
      message: 'Paid users fetched successfully',
      data: usersWithWalletAndPayment,
      todayInstalled: todayInstalledCount,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalUsers / limit),
        totalUsers: totalUsers,
      },
    });

  } catch (error) {
    console.error("Paid users error:", error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Error while fetching paid users',
      error: error.message,
    });
  }
});


//new
router.get('/user-stats', async (req, res) => {
  try {
    const dateFilter = req.query.date ? { 
      createdAt: { 
        $gte: new Date(req.query.date), 
        $lt: new Date(new Date(req.query.date).setDate(new Date(req.query.date).getDate() + 1))
      } 
    } : {};

    const [usersWithMultipleTransactions, usersWithZeroTransactions] = await Promise.all([
      User.countDocuments({
        _id: { $in: (await Transaction.distinct('user', { 
          status: 'success', 
          ...dateFilter 
        })) }
      }),
      User.countDocuments({
        _id: { $nin: (await Transaction.distinct('user', { 
          status: 'success', 
          ...dateFilter 
        })) }
      })
    ]);

    res.status(200).json({ 
      usersWithMultipleTransactions, 
      usersWithZeroTransactions 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});






router.get('/payment-summary', async (req, res) => {
  try {
    const summary = await Transaction.aggregate([
      {
        $match: {
          status: { $in: ['success', 'failure'] },
        },
      },
      {
        $facet: {
          user: [
            { $match: { user: { $ne: null } } },
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
                totalAmount: { $sum: '$amount' },
              },
            },
          ],
          astrologer: [
            { $match: { astrologer: { $ne: null } } },
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
                totalAmount: { $sum: '$amount' },
              },
            },
          ],
        },
      },
    ])

    res.json(summary[0])
  } catch (err) {
    console.error('Error fetching payment summary:', err)
    res.status(500).json({ error: 'Failed to fetch payment summary' })
  }
})

////

router.get('/get-trans/:userId', async (req, res) => {
  logger.info('get-trans/:userId Api is Execute')
  const { userId } = req.params
  try {
    const transactions = await Transaction.find({ user: userId })

    if (!transactions || transactions.length === 0) {
      logger.info('No transactions found for this user')
      return res
        .status(200)
        .json({ error: 'No transactions found for this user' })
    }
    const totalAmount = transactions.reduce(
      (sum, transaction) => sum + (transaction.amount || 0),
      0
    )
    logger.info('Transaction and Total Amount success')
    res.status(200).json({
      success: true,
      transactions,
      totalAmount,
    })
  } catch (err) {
    logger.error(err)
    res.status(500).json({ error: err.message })
  }
})

router.get('/astrologer-trans/:astrologerId', async (req, res) => {
  logger.info('astrologer-trans/:astrologerId api is execute')
  const { astrologerId } = req.params
  try {
    const transactions = await Transaction.find({
      astrologer: astrologerId,
      type: 'debit',
    })

    if (!transactions || transactions.length === 0) {
      logger.info('No transactions found for this Astrologer')
      return res.status(200).json({
        success: false,
        message: 'No transactions found for this Astrologer',
      })
    }
    logger.info('Transaction success')
    res.status(200).json({
      success: true,
      transactions: transactions,
    })
  } catch (err) {
    logger.error(err)
    res.status(500).json({
      error: err.message,
    })
  }
})

router.put('/updateOrder', async (req, res) => {
  logger.info('Update Order api start')
  const { orderId, userId, amountPaid, statusPaid } = req.body
  try {
    const transaction = await Transaction.findOne({
      orderId: orderId,
      status: 'created',
    })

    if (statusPaid !== 'paid') {
      logger.info("Order status is not 'paid'.")
      return res.status(400).json({
        success: false,
        message: "Order status is not 'paid'.",
      })
    }

    const user = await User.findById(userId).select('wallet')

    user.wallet += amountPaid
    await user?.save()

    transaction.status = 'success'
    transaction.amount = amountPaid
    await transaction?.save()
    logger.info('transaction successfully')
    return res.status(200).json({
      success: true,
      message: 'Transaction successfull',
      userWalletBalance: user.wallet,
      transactionStatus: transaction.status,
    })
  } catch (error) {
    logger.info(error)
    return res.status(500).json({
      success: false,
      message: error.message,
    })
  }
})

router.post('/get-transactions', async (req, res) => {
  logger.info('Get transaction Api is executed')
  const { type, filter } = req.body

  if (!['credit', 'debit'].includes(type)) {
    logger.info('Invalid transaction type.')
    return res.status(400).json({
      error: 'Invalid transaction type.',
    })
  }

  try {
    const transactions = await Transaction.find({ type: type })
      .populate('user', 'userName')
      .populate('astrologer', 'astrologerName')

    let filteredTransactions = transactions
    if (filter === 'success') {
      filteredTransactions = transactions.filter((t) => t.status === 'success')
    } else if (filter === 'failure') {
      filteredTransactions = transactions.filter((t) => t.status === 'failure')
    } else if (filter === 'created') {
      filteredTransactions = transactions.filter((t) => t.status === 'created')
    }

    const totalAmount = filteredTransactions.reduce(
      (sum, t) => sum + (t.amount || 0),
      0
    )

    res.status(200).json({
      success: true,
      transactions: filteredTransactions,
      totalAmount: totalAmount,
    })
  } catch (err) {
    logger.error('An error occurred while fetching transactions.', err)
    res.status(500).json({
      error: 'An error occurred while fetching transactions.',
    })
  }
})
// router.post('/get-transactions-info', async (req, res) => {
//   logger.info('Get Transaction info api is start')
//   const { type, filter } = req.body

//   const pageNumber = parseInt(req.query.page) || 1
//   const perPage = 10
//   const skip = (pageNumber - 1) * perPage

//   if (!['credit', 'debit'].includes(type)) {
//     logger.error('Invalid transaction type.')
//     return res.status(400).json({
//       error: 'Invalid transaction type.',
//     })
//   }

//   const validFilters = ['success', 'failure', 'created']
//   if (filter && !validFilters.includes(filter)) {
//     logger.info('Invalid filter type.')
//     return res.status(400).json({
//       error: 'Invalid filter type.',
//     })
//   }

//   try {
//     const query = { type, description: { $ne: 'payment credited' } }
//     if (filter) {
//       query.status = filter
//     }

//     const totalCount = await Transaction.countDocuments(query)

//     const transactions = await Transaction.find(query)
//       .sort({ updatedAt: -1 })
//       .skip(skip)
//       .limit(perPage)
//       .populate({
//         path: 'user',
//         select: '_id userName phone_number',
//       })
//       .populate({
//         path: 'astrologer',
//         select:
//           '_id astrologerId astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt isActive',
//       })

//     const totalPages = Math.ceil(totalCount / perPage)

//     // console.log(transactions.length);
//     const totalAmountResult = await Transaction.aggregate([
//       { $match: query },
//       { $group: { _id: null, totalAmount: { $sum: '$amount' } } },
//     ])

//     const totalAmount = totalAmountResult[0]?.totalAmount || 0

//     const formattedTransactions = transactions.map((t) => {
//       const formattedDate = moment(t.date)
//         .tz('Asia/Kolkata')
//         .format('DD/MM/YYYY')
//       const formattedTime = moment(t.date).tz('Asia/Kolkata').format('hh:mm A')

//       return {
//         ...t.toObject(),
//         date: `${formattedDate} ${formattedTime}`,
//         userId: t.user?._id,
//         astrologerId: t.astrologer?._id, // Add astrologerId from populated astrologer
//         userPhoneNumber: t.user?.phone_number, // Add user's phone number
//         astrologerPhoneNumber: t.astrologer?.phone_number,
//       }
//     })

//     res.status(200).json({
//       success: true,
//       transactions: formattedTransactions,
//       totalAmount,
//       totalPages, // Total number of pages
//       totalCount, // Total number of transactions
//       page: pageNumber, // Current page
//       perPage, // Records per page
//     })
//   } catch (err) {
//     console.error(err) // Log error for debugging
//     res.status(500).json({
//       error: 'An error occurred while searching transactions.',
//     })
//   }
// })

//update api
router.post('/get-transactions-info', async (req, res) => {
  logger.info('Get Transaction info api is start')
  const { type, filter } = req.body

  const pageNumber = parseInt(req.query.page) || 1
  const perPage = 10
  const skip = (pageNumber - 1) * perPage

  if (!['credit', 'debit'].includes(type)) {
    logger.error('Invalid transaction type.')
    return res.status(400).json({
      error: 'Invalid transaction type.',
    })
  }

  const validFilters = ['success', 'failure', 'created']
  if (filter && !validFilters.includes(filter)) {
    logger.info('Invalid filter type.')
    return res.status(400).json({
      error: 'Invalid filter type.',
    })
  }

  try {
    const query = { type, description: { $ne: 'payment credited' } }
    if (filter) {
      query.status = filter
    }

    const totalCount = await Transaction.countDocuments(query)

    const transactions = await Transaction.find(query)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(perPage)
      .populate({
        path: 'user',
        select: '_id userName phone_number',
      })
      .populate({
        path: 'astrologer',
        select:
          '_id astrologerId astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt isActive currentTabVersion upi', // Added fields here
      })

    const totalPages = Math.ceil(totalCount / perPage)

    const totalAmountResult = await Transaction.aggregate([
      { $match: query },
      { $group: { _id: null, totalAmount: { $sum: '$amount' } } },
    ])

    const totalAmount = totalAmountResult[0]?.totalAmount || 0

    const formattedTransactions = transactions.map((t) => {
      const formattedDate = moment(t.date)
        .tz('Asia/Kolkata')
        .format('DD/MM/YYYY')
      const formattedTime = moment(t.date).tz('Asia/Kolkata').format('hh:mm A')

      return {
        ...t.toObject(),
        date: `${formattedDate} ${formattedTime}`,
        userId: t.user?._id,
        astrologerId: t.astrologer?._id,
        userPhoneNumber: t.user?.phone_number,
        astrologerPhoneNumber: t.astrologer?.phone_number,
        astrologer: {
          ...t.astrologer?.toObject(), // Include all astrologer fields
          currentTabVersion: t.astrologer?.currentTabVersion, // Added field
          upi: t.astrologer?.upi, // Added field
        },
      }
    })

    res.status(200).json({
      success: true,
      transactions: formattedTransactions,
      totalAmount,
      totalPages,
      totalCount,
      page: pageNumber,
      perPage,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: 'An error occurred while searching transactions.',
    })
  }
})

//end update api

router.get('/get-transactions', async (req, res) => {
  logger.info('Get-transactions/:year api is start')
  const { year } = req.params

  try {
    const startDate = new Date(year, 0, 1) // Start of the year
    const endDate = new Date(year, 11, 31) // End of the year

    const transactions = await Transaction.aggregate([
      {
        $match: {
          date: {
            $gte: startDate,
            $lte: endDate,
          },
        },
      },
      {
        $group: {
          _id: { $month: '$date' },
          totalAmount: { $sum: '$amount' },
        },
      },
      {
        $sort: { _id: 1 }, // Sort by month
      },
    ])

    // Create an array for the response, initializing to 0 for all months
    const monthlyTotals = Array(12).fill(0)

    // Fill the monthlyTotals array with the results from the aggregation
    transactions.forEach((transaction) => {
      monthlyTotals[transaction._id - 1] = transaction.totalAmount
    })
    logger.info('success')
    res.status(200).json({
      success: true,
      monthlyTotals,
    })
  } catch (err) {
    logger.error(err)
    res.status(500).json({ error: err.message })
  }
})

router.get('/get-withdrawals/:year', async (req, res) => {
  logger.info('get-withdrawals/:year api is start')
  const { year } = req.params

  try {
    const startDate = new Date(year, 0, 1) // Start of the year
    const endDate = new Date(year, 11, 31) // End of the year

    const withdrawals = await Transaction.aggregate([
      {
        $match: {
          date: {
            $gte: startDate,
            $lte: endDate,
          },
          type: 'debit', // Match withdrawal transactions (debit)
          status: 'success', // Only consider successful transactions
        },
      },
      {
        $group: {
          _id: { $month: '$date' },
          totalAmount: { $sum: '$amount' },
        },
      },
      {
        $sort: { _id: 1 }, // Sort by month
      },
    ])

    // Create an array for the response, initializing to 0 for all months
    const monthlyWithdrawals = Array(12).fill(0)

    // Fill the monthlyWithdrawals array with the results from the aggregation
    withdrawals.forEach((withdrawal) => {
      monthlyWithdrawals[withdrawal._id - 1] = withdrawal.totalAmount
    })
    logger.info('success')
    res.status(200).json({
      success: true,
      monthlyWithdrawals,
    })
  } catch (err) {
    logger.error(err)
    res.status(500).json({ error: err.message })
  }
})
router.get('/filter-Transactions-by-date', async (req, res) => {
  logger.info('filter Transaction by date api')
  try {
    const { date } = req.query
    if (!date) {
      logger.info('Date parameter is required')
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Date parameter is required',
      })
    }
    const startOfDay = new Date(date)
    startOfDay.setHours(0, 0, 0, 0)
    const endOfDay = new Date(date)
    endOfDay.setHours(23, 59, 59, 999)
    const transactions = await Transaction.find({
      date: { $gte: startOfDay, $lte: endOfDay },
    }).exec()
    if (transactions?.length === 0) {
      logger.info('No transactions found for the selected date')
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No transactions found for the selected date',
      })
    }
    logger.info('Transactions retrieved successfully')
    res.status(200).json({
      success: true,
      status: 200,
      message: 'Transactions retrieved successfully',
      data: transactions,
    })
  } catch (error) {
    logger.error('Error filtering transactions by date:', error)
    res.status(500).json({
      success: false,
      status: 500,
      message: `Server error: ${error.message}`,
    })
  }
})
// router.post("/search-transactions", async (req, res) => {
//   const searchQuery = req.query.searchQuery || ""; // Get searchQuery from query params, default to an empty string
//   const { type, filter } = req.body; // Get type and filter from the request body
//   const pageNumber = parseInt(req.query.page) || 1; // Get page from query params, default to 1 if invalid
//   const perPage = 10; // Number of records per page
//   const skip = (pageNumber - 1) * perPage; // Calculate records to skip based on page

//   // Validate type (credit or debit)
//   if (type && !["credit", "debit"].includes(type)) {
//     return res.status(400).json({
//       error: "Invalid transaction type.",
//     });
//   }

//   // Validate filter (optional) - default to all if no filter is provided
//   const validFilters = ["success", "failure", "created"];
//   if (filter && !validFilters.includes(filter)) {
//     return res.status(400).json({
//       error: "Invalid filter type.",
//     });
//   }

//   try {
//     // Build a dynamic search query
//     const searchRegex = new RegExp(searchQuery, "i"); // Case-insensitive regex for search
//     const query = {
//       $or: [
//         { "user.userName": searchRegex },
//         { "user.phone_number": searchRegex },
//         { "astrologer.astrologerName": searchRegex },
//         { "astrologer.phone_number": searchRegex },
//       ],
//     };

//     // Add type and filter to the query if provided
//     if (type) query.type = type;
//     if (filter) query.status = filter;

//     // Fetch the transactions with pagination and search
//     const transactions = await Transaction.find(query)
//       .sort({ date: -1 })
//       .skip(skip) // Skip for pagination
//       .limit(perPage) // Limit to 30 records per page
//       .populate({
//         path: "user",
//         select: "_id userName phone_number", // Include user ID, userName, and phone_number
//       })
//       .populate({
//         path: "astrologer",
//         select: "_id astrologerName phone_number", // Include astrologer ID, astrologerName, and phone_number
//       });

//     const totalCount = transactions?.length;
//     const totalPages = Math.ceil(totalCount / perPage);

//     // Calculate the total amount of transactions fetched
//     const totalAmount = transactions.reduce(
//       (sum, t) => sum + (t.amount || 0),
//       0
//     );

//     // Format the date and time in Indian Standard Time
//     const formattedTransactions = transactions.map(t => {
//       const formattedDate = moment(t.date)
//         .tz('Asia/Kolkata')
//         .format('DD/MM/YYYY');
//       const formattedTime = moment(t.date)
//         .tz('Asia/Kolkata')
//         .format('hh:mm A');

//       return {
//         ...t.toObject(),
//         date: `${formattedDate} ${formattedTime}`, // Combine formatted date and time
//         userId: t.user?._id, // Add userId from populated user
//         astrologerId: t.astrologer?._id, // Add astrologerId from populated astrologer
//         userPhoneNumber: t.user?.phone_number, // Add user's phone number
//         astrologerPhoneNumber: t.astrologer?.phone_number, // Add astrologer's phone number
//       };
//     });

//     res.status(200).json({
//       success: true,
//       transactions: formattedTransactions,
//       totalAmount,
//       totalPages, // Total number of pages
//       page: pageNumber, // Current page
//       perPage, // Records per page
//     });
//   } catch (err) {
//     console.error(err); // Log error for debugging
//     res.status(500).json({
//       error: "An error occurred while searching transactions.",
//     });
//   }
// });

router.get('/get-transactions-stats', async (req, res) => {
  const { year } = req.query
  try {
    if (!year || isNaN(year)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing year parameter',
      })
    }
    const startDate = new Date(`${year}-01-01T00:00:00Z`)
    const endDate = new Date(`${year}-12-31T23:59:59Z`)
    const transactions = await Transaction.aggregate([
      {
        $match: {
          date: { $gte: startDate, $lte: endDate }, // Filter transactions in this date range
          type: 'credit', // Only 'credit' transactions
          status: 'success',// Only those with status 'success'
        },
      }, //in this stage it gives dates range with filters
      {
        $group: { // in this stage it takes dates range and filter them in like in group table, id:1 count:2, id:2 count:3, until dates range
          _id: { $month: '$date' }, //here $month gives month number from date(date from models/Transaction), date in form of yy-mm-dd-time
          //$month built in keyword, 
          count: { $sum: 1 },
        },
        //ex : [
  //{ _id: 1, count: 23 }, // January
  //{ _id: 2, count: 17 }, // February
 // ...
//]

      },
      { $sort: { _id: 1 } },//1 for ascending, -1 for descending
    ])
    const monthlyCounts = Array(12).fill(0) // Create an array of length 12 filled with zeros, 12 becs 12 momths
    transactions.forEach((transaction) => { //transactions from above aggregative func.
      monthlyCounts[transaction._id - 1] = transaction.count// from above trasactions aggregative
    })//Uses _id (month number) to place the count in the correct index (_id - 1 because JavaScript arrays are zero-based).
    res.status(200).json({
      success: true,
      monthlyCounts,
    })
  } catch (err) {
    // Handle errors
    console.error('Error fetching transaction stats:', err)
    res.status(500).json({
      success: false,
      message: 'Error fetching transaction stats',
      error: err.message,
    })
  }
})

router.get('/get-withdrawals', async (req, res) => {
  const { year } = req.query
  try {
    const startDate = new Date(year, 0, 1)
    const endDate = new Date(year, 11, 31)
    const withdrawals = await Transaction.aggregate([
      {
        $match: {
          date: {
            $gte: startDate,
            $lte: endDate,
          },
          type: 'debit', // Only 'credit' transactions
          status: 'success',  // Only those with status 'success'
        },
      },
      {
        $group: {
          _id: { $month: '$date' },
          totalAmount: { $sum: '$amount' },
        },
      },
      {
        $sort: { _id: 1 }, // Sort by month
      },
    ])
    // Create an array for the response, initializing to 0 for all months
    const monthlyWithdrawals = Array(12).fill(0)
    // Fill the monthlyWithdrawals array with the results from the aggregation
    withdrawals.forEach((withdrawal) => {
      monthlyWithdrawals[withdrawal._id - 1] = withdrawal.totalAmount
    })
    res.status(200).json({
      success: true,
      monthlyWithdrawals,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/search-transactions', async (req, res) => {
  const { search, type, filter } = req.body
  const pageNumber = parseInt(req.query.page) || 1
  const perPage = 10
  const skip = (pageNumber - 1) * perPage
  try {
    const query = {}
    if (type) {
      query.type = type
    }
    if (filter) {
      query.status = filter
    }

    // Fetch transactions with pagination and populate
    const transactions = await Transaction.find(query)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(perPage)
      .populate({
        path: 'user',
        select: '_id userName phone_number', // Populate user fields
      })
      .populate({
        path: 'astrologer',
        select:
          '_id astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt',
      })

    // If `search` is provided, filter in-memory
    let filteredTransactions = transactions
    if (search) {
      const searchRegex = new RegExp(search, 'i') // Case-insensitive search
      filteredTransactions = transactions.filter((t) => {
        return (
          searchRegex.test(t.user?.userName || '') || // Match userName
          searchRegex.test(t.user?.phone_number || '') || // Match user's phone number
          searchRegex.test(t.astrologer?.astrologerName || '') || // Match astrologerName
          searchRegex.test(t.astrologer?.phone_number || '') // Match astrologer's phone number
        )
      })
    }

    // Format data and calculate totals
    const totalAmount = filteredTransactions.reduce(
      (sum, t) => sum + (t.amount || 0),
      0
    )

    const formattedTransactions = filteredTransactions.map((t) => {
      const formattedDate = moment(t.date)
        .tz('Asia/Kolkata')
        .format('DD/MM/YYYY')
      const formattedTime = moment(t.date).tz('Asia/Kolkata').format('hh:mm A')

      return {
        ...t.toObject(),
        date: `${formattedDate} ${formattedTime}`,
        userId: t.user?._id,
        astrologerId: t.astrologer?._id,
        userPhoneNumber: t.user?.phone_number,
        astrologerPhoneNumber: t.astrologer?.phone_number,
      }
    })
    res.status(200).json({
      success: true,
      transactions: formattedTransactions.slice(0, perPage), // Return only the current page's data
      totalAmount,
      totalPages: Math.ceil(filteredTransactions.length / perPage), // Calculate total pages
      page: pageNumber,
      perPage,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: 'An error occurred while searching transactions.',
    })
  }
})

router.post('/get-payments-by-date', async (req, res) => {
  const { type, filter, date } = req.body
  console.log(type)
  const pageNumber = parseInt(req.query.page) || 1
  const perPage = 10
  const skip = (pageNumber - 1) * perPage
  if (!['credit', 'debit'].includes(type)) {
    return res.status(400).json({
      error: 'Invalid transaction type.',
    })
  }
  const validFilters = ['success', 'failure', 'created']
  if (filter && !validFilters.includes(filter)) {
    return res.status(400).json({
      error: 'Invalid filter type.',
    })
  }
  if (!date || !moment(date, 'YYYY-MM-DD', true).isValid()) {
    return res.status(400).json({
      error: 'Invalid or missing date. Expected format: YYYY-MM-DD.',
    })
  }

  try {
    const query = { type, description: { $ne: 'payment credited' } }

    if (filter) {
      query.status = filter
    }

    const startOfDay = moment
      .tz(date, 'YYYY-MM-DD', 'Asia/Kolkata')
      .startOf('day')
      .toDate()
    const endOfDay = moment
      .tz(date, 'YYYY-MM-DD', 'Asia/Kolkata')
      .endOf('day')
      .toDate()

    query.date = {
      $gte: startOfDay,
      $lte: endOfDay,
    }

    const transactions = await Transaction.find(query)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(perPage)
      .populate({
        path: 'user',
        select: '_id userName phone_number',
      })
      .populate({
        path: 'astrologer',
        select:
          '_id astrologerName phone_number status category known_languages expertIn experience order_bookings cost profile_photo wallet createdAt',
      })
    const transactionsForAmount = await Transaction.find(query)
      .sort({ updatedAt: -1 })
      .select('amount status')

    const totalCount = await Transaction.countDocuments(query)
    const totalPages = Math.ceil(totalCount / perPage)
    const totalAmount = transactionsForAmount.reduce(
      (sum, t) => sum + (t.amount || 0),
      0
    )
    const formattedTransactions = transactions.map((t) => {
      const formattedDate = moment(t.date)
        .tz('Asia/Kolkata')
        .format('DD/MM/YYYY')
      const formattedTime = moment(t.date).tz('Asia/Kolkata').format('hh:mm A')
      return {
        ...t.toObject(),
        date: `${formattedDate} ${formattedTime}`,
        userId: t.user?._id,
        astrologerId: t.astrologer?._id,
        userPhoneNumber: t.user?.phone_number,
        astrologerPhoneNumber: t.astrologer?.phone_number,
      }
    })

    res.status(200).json({
      success: true,
      transactions: formattedTransactions,
      totalAmount,
      totalPages,
      totalCount,
      page: pageNumber,
      perPage,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: 'An error occurred while fetching transactions.',
    })
  }
})

router.get('/get-trans-data/:userId', async (req, res) => {
  logger.info('get-trans/:userId API is executing')
  const { userId } = req.params

  // Extract page and limit from query parameters, with default values
  let { page = 1, limit = 10 } = req.query

  // Convert page and limit to integers
  page = parseInt(page, 10)
  limit = parseInt(limit, 10)

  try {
    // Calculate skip for pagination
    const skip = (page - 1) * limit

    // Fetch paginated transactions
    const transactions = await Transaction.find({ user: userId })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)

    const findSuccessTransactionsDetails = await Transaction.find({
      user: userId,
      status: 'success',
    })
    const successCount = findSuccessTransactionsDetails.length
    const totalSuccessAmount = findSuccessTransactionsDetails.reduce(
      (sum, transaction) => sum + transaction.amount,
      0
    )

    const findFailureTransactionsDetails = await Transaction.find({
      user: userId,
      status: 'failure',
    })
    const failureCount = findFailureTransactionsDetails.length
    const totalFailureAmount = findFailureTransactionsDetails.reduce(
      (sum, transaction) => sum + transaction.amount,
      0
    )

    const totalTransactionsDetails = {
      successCount,
      totalSuccessAmount,
      failureCount,
      totalFailureAmount,
    }

    if (!transactions || transactions.length === 0) {
      logger.info('No transactions found for this user')
      return res.status(200).json({
        success: false,
        message: 'No transactions found for this user',
      })
    }

    // Calculate total amount for all transactions (ignoring pagination)
    const totalAmount = await Transaction.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
        },
      },
    ])

    // Fetch total count for pagination metadata
    const totalCount = await Transaction.countDocuments({ user: userId })

    logger.info('Transaction and Total Amount success')
    res.status(200).json({
      success: true,
      transactions,
      totalTransactionsDetails,
      pagination: {
        total: totalCount,
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        perPage: limit,
      },
      totalAmount: totalAmount[0]?.totalAmount || 0, // Handle case where no transactions exist
    })
  } catch (err) {
    logger.error('Error in get-trans/:userId API', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
