const mongoose = require("mongoose");
const Razorpay = require('razorpay')
const cron = require('node-cron')
const Transaction = require('../models/Transaction')
const User = require('../models/User')
const logger = require('../Logger')
const Astrologer = require('../models/Astrologer')
const PreferredTime = require('../models/PreferredTime')
const CalendarLog = require('../models/CalenderLog')
const { uploadMsgsToAwsInJson } = require('./msgsToAwsS3Bucket')
const Queue = require('../models/Queue')
const QueueBuckets = require("../models/QueueBucket");
const { checkUserPresence, sendCustomEvent } = require("../Xmppevents");
const { call_reminder } = require("./exotel");
const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_SECRET_KEY,
})

const cleanUpOldTransactions = async () => {
  cron.schedule('0 1 * * *', async () => {
    try {
      const currentTime = new Date()
      const transactions = await Transaction.find({
        status: { $in: ['created', 'attempted'] },
      })

      for (let transaction of transactions) {
        const createdAt = new Date(transaction.date)
        const timeDiff = (currentTime - createdAt) / (1000 * 60)

        if (timeDiff >= 10) {
          const orderId = transaction?.orderId
          let orderDetails = await razorpayInstance.orders.fetch(orderId)
          logger.info(orderDetails)
          if (orderDetails.status === 'paid') {
            await Transaction.findOneAndUpdate(
              {
                orderId: transaction?.orderId,
                status: { $in: ['created', 'attempted'] },
              },
              {
                status: 'success',
              },
              { new: true }
            )

            const user = await User.findOne({ _id: transaction?.user }).select(
              'wallet'
            )
            user.wallet += transaction.amount
            await user?.save()
            logger.info(
              `Transaction success, wallet updated for user ${user._id}`
            )
          }
        }
        if (timeDiff >= 90) {
          // eslint-disable-next-line no-unused-vars
          let deleteTrx = await Transaction.findOneAndDelete({
            orderId: transaction?.orderId,
            status: { $in: ['created', 'attempted'] },
          })
        }
      }
      logger.info('Old transactions cleaned')
    } catch (error) {
      logger.error('Error cleaning up old transactions:', error)
    }
  })
}

const preferredTimeEveryFifteenMinutes = () => {
  cron.schedule('0,15,30,45 * * * *', async () => {
    try {
      logger.info('Running preferred time every 15 minutes')
      const allAstrologers = await Astrologer.find({
        isActive: true,
        // phone_number: "9000939016"
      })
      const offlineAstrologers = allAstrologers.filter(
        (astrologer) => astrologer?.status === 'offline'
      )
      const availableAstrologers = allAstrologers.filter(
        (astrologer) => astrologer?.status === 'available'
      )
      const now = new Date()
      const istOffset = 5.5 * 60 * 60 * 1000
      const istTime = new Date(now.getTime() + istOffset)
      const todayISTDay = istTime
        .toLocaleDateString('en-US', { weekday: 'long' })
        .toLowerCase()
      const nowTimebyIST = istTime.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
      const nowUTC = new Date()
      const todayUTC = new Date(
        Date.UTC(
          nowUTC.getUTCFullYear(),
          nowUTC.getUTCMonth(),
          nowUTC.getUTCDate()
        )
      )
      for (const astro of offlineAstrologers) {
        const preferredT = await PreferredTime.findOne({
          astrologerId: astro._id,
          'days.day': todayISTDay,
        })

        if (!preferredT) {
          // logger.info("line 99")
          continue
        } else {
          const todayPreferred = preferredT?.days?.find(
            (d) => d?.day === todayISTDay
          )
          // logger.info("103");
          const matchingPre = todayPreferred?.preferredTime?.find(
            (slot) => slot?.startTime === nowTimebyIST
          )
          // logger.info(`line no 540 ${nowTimebyIST}`);
          if (matchingPre) {
            // logger.info(`Astrologer ${astro.astrologerName} has a preferred slot at ${matchingPre.startTime}`);
            // logger.info(`IST Time: ${istTime.toISOString()}, Day: ${todayISTDay}, Current Time: ${nowTimebyIST}`);
            astro.status = 'available'
            astro.lastOnline = nowUTC
            await astro.save()

            let calendarLog = await CalendarLog.findOne({
              astrologerId: astro._id,
              date: todayUTC,
            })

            if (!calendarLog) {
              calendarLog = new CalendarLog({
                astrologerId: astro?._id,
                date: todayUTC,
              })
            } else {
              const lastSession =
                calendarLog?.sessions[calendarLog?.sessions?.length - 1]
              if (lastSession && !lastSession?.endTime) {
                lastSession.endTime = nowUTC
                // logger.info("565");
              }
            }
            calendarLog?.sessions?.push({ startTime: nowUTC })
            await calendarLog.save()
            // logger.info("570");
          }
        }
      }

      for (const astro of availableAstrologers) {
        const preferredT = await PreferredTime.findOne({
          astrologerId: astro._id,
          'days.day': todayISTDay,
        })
        if (!preferredT) {
          continue
        } else {
          const todayPreferred = preferredT?.days?.find(
            (d) => d?.day === todayISTDay
          )
          const matchingPre = todayPreferred?.preferredTime?.find(
            (slot) => slot?.endTime === nowTimebyIST
          )
          if (matchingPre) {
            astro.status = 'offline'
            astro.lastOffline = nowUTC
            await astro.save()

            let calendarLog = await CalendarLog.findOne({
              astrologerId: astro._id,
              date: todayUTC,
            })
            if (calendarLog) {
              const latestSession =
                calendarLog?.sessions[calendarLog?.sessions?.length - 1]
              if (latestSession && !latestSession?.endTime) {
                latestSession.endTime = nowUTC
                await calendarLog.save()
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error in cron job:', error)
    }
  })
}

const historyMsgsToAwsS3Bucket = async () => {
  cron.schedule('30 1 * * *', async () => {
    try {
      await uploadMsgsToAwsInJson()
    } catch (error) {
      logger.error(
        `error runningf cronjob on historyMsgsToAwsS3Bucket: ${error}`
      )
    }
  })
}




const endingPendingChats = async () => {
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();
      const oneMinuteAgo = new Date(now - 1 * 60 * 1000);
      const tenMinutesAgo = new Date(now - 10 * 60 * 1000);

      const chats = await Queue.find({ status: "waiting" });
      // console.log(`Total 'waiting' chats found: ${chats?.length}`);

      const freeChats = chats?.filter(chat => chat?.cost === "free" && new Date(chat?.createdAt) < oneMinuteAgo);
      const paidChats = chats?.filter(chat => chat?.cost !== "free" && new Date(chat?.createdAt) < tenMinutesAgo);

      // console.log(`Free chats older than 1 minute: ${freeChats?.length}`);
      // console.log(`Paid chats older than 10 minutes: ${paidChats?.length}`);

      const astrologerIds = [...new Set(paidChats?.map(chat => chat?.assignedAstrologer?.toString())?.filter(Boolean))];
      const astrologers = await Astrologer.find({ _id: { $in: astrologerIds } });

      const astrologerStatusMap = astrologers?.reduce((acc, astrologer) => {
        acc[astrologer?._id?.toString()] = astrologer?.status;
        return acc;
      }, {});

      const astrologerIdsObject = astrologerIds?.map(id => new mongoose.Types.ObjectId(id));

      const astrologerQueues = await Queue.aggregate([
        {
          $match: {
            assignedAstrologer: { $in: astrologerIdsObject },
            status: { $in: ["waiting", "waiting for user", "live"] }
          }
        },
        {
          $group: {
            _id: "$assignedAstrologer",
            queueCount: { $sum: 1 }
          }
        }
      ]);

      const astrologerQueueMap = astrologerQueues?.reduce((acc, entry) => {
        acc[entry?._id?.toString()] = entry?.queueCount;
        return acc;
      }, {});

      const paidChatsToFail = paidChats?.filter(chat => {
        const astrologerId = chat?.assignedAstrologer?.toString();
        const astrologerStatus = astrologerStatusMap[astrologerId];
        const queueCount = astrologerQueueMap[astrologerId] || 0;

        return (astrologerStatus === "available" && queueCount === 1) || astrologerStatus === "offline";
      });

      if (paidChatsToFail?.length > 0) {
        const result = await Queue.updateMany(
          { _id: { $in: paidChatsToFail?.map(chat => chat?._id) } },
          { $set: { status: "failed", failReason: "No astrologer picked within the allowed time" } },
          { new: true }
        );
        // console.log(`Updated ${result?.modifiedCount} paid chats to 'failed'.`);
      }

      // ✅ Handle Free Chats
      // console.log(`Assigning astrologers to ${freeChats.length} free chats`);

      for (const freeChat of freeChats) {
        // console.log(`🔄 Processing Free Chat: ${freeChat?._id}, CreatedAt: ${freeChat?.createdAt}`);
      
        if (freeChat?.availableAstrologers?.length > 0) {
          // console.log(`🟢 Assigning astrologers to free chat ${freeChat}`);
          await assignAvailableAstrologersToQueue(freeChat);
        } else {
          // console.log(`⚠️ Skipping free chat ${freeChat?._id} — already has astrologers assigned.`);
          // console.log(`📨 Already assigned astrologers: ${freeChat?.availableAstrologers?.map(a => a?.astrologerId?.toString())}`);
        }
      
        const updated = await Queue.findById(freeChat?._id);
        // console.log(`✅ After assignment, availableAstrologers count: ${updated?.availableAstrologers?.length}`);
      }
      

    } catch (error) {
      logger.error("Error updating failed chats or assigning astrologers:", error);
    }
  });
};





async function assignAvailableAstrologersToQueue(queue) {
  try {
    // console.log("Starting assignAvailableAstrologersToQueue for queue:", queue?._id);
    queue = await Queue.findOne({ _id: queue?._id });
    if(queue?.status != "waiting") return

    const existingAstrologerIds = new Set(
      (queue?.availableAstrologers || [])?.map(item =>
        item?.astrologerId.toString()
      )
    );
    // console.log("Existing astrologer IDs in queue:", [...existingAstrologerIds]);

    const statuses = ["available", "waiting", "busy"];
    let selectedBucket = null;
    let filteredAstrologers = [];

    // Step 1: Loop over buckets to find a suitable one
    for (const status of statuses) {
      // console.log(`Looking for buckets with status: ${status}`);
      const buckets = await QueueBuckets.find({
        env: process.env.NODE_ENV_PRODUCTION || "DEVELOPMENT",
        bucketStatus: status,
      }).sort({ bucketNumber: 1 });
      // console.log(`Found ${buckets.length} buckets with status ${status}`);

      for (const bucket of buckets) {
        const newAstrologers = bucket.availableAstrologers.filter(id =>
          !existingAstrologerIds.has(id.toString())
        );
        // console.log(
        //   `Bucket ${bucket} has ${bucket?.availableAstrologers} astrologers, ${newAstrologers?.length} new astrologers after filtering`
        // );

        if (newAstrologers?.length > 0) {
          selectedBucket = bucket;
          filteredAstrologers = newAstrologers;
          // console.log(
          //   `Selected bucket ${bucket.bucketNumber} with ${filteredAstrologers.length} new astrologers`
          // );
          break;
        }
      }

      if (selectedBucket) break;
    }

    if (!selectedBucket || filteredAstrologers.length === 0) {
      // console.warn("No new available astrologers found in any bucket.");
      return null;
    }

    // Step 2: Move current availableAstrologers to unAssignedAstrologers
    if (queue?.availableAstrologers && queue?.availableAstrologers?.length > 0) {
      // console.log(
      //   `Moving ${queue?.availableAstrologers?.length} astrologers from availableAstrologers to unAssignedAstrologers`
      // );
      queue.unAssignedAstrologers = [
        ...(queue.unAssignedAstrologers || []),
        ...queue.availableAstrologers,
      ];
    } else {
      // console.log("No existing available astrologers to move.");
    }

    // Step 3: Assign new astrologers
    // console.log(`Assigning ${filteredAstrologers.length} new astrologers to queue`);
    queue.availableAstrologers = filteredAstrologers.map(id => ({
      astrologerId: id,
    }));

    // Step 4: Save the updated queue
    await queue.save();
    await Promise.all(
      queue?.availableAstrologers?.map(async (astrologer) => {
        try {
          let astrologer1 = await Astrologer.findOne({ _id: astrologer?.astrologerId });
          // console.log(
          //   astrologer1
          //     ? `astrologer1 found: ${astrologer1}`
          //     : "Astrologer not found for"
          // );
          
          if (astrologer1?.status === "available") {
            let checkXmppPresence = await checkUserPresence(astrologer1?._id);
            // console.log(
            //   checkXmppPresence
            //     ? `checkXmppPresence found: ${checkXmppPresence.toString()}`
            //     : "checkXmppPresence not found for"
            // );
            if (checkXmppPresence?.success == true && (checkXmppPresence?.data?.show == "available" || checkXmppPresence?.data?.show == "chat")) {
              logger.info(`queue.js util 314: dataCall sent event to astrologer`);
              await sendCustomEvent(astrologer1?._id, "custom event notification", { event: `${queue?.type} notification`, message: `user added to waiting list, please join` });
              await sendCustomEvent(astrologer1?._id, "custom event notification", { event: "dataCall sent", message: `Getting order from ${queue?.userName}`, type: queue?.type });
              setTimeout(async () => {
                const checkQueStatus = await Queue.findOne({ _id: queue?._id });
                if (checkQueStatus?.status !== "waiting") {
                  clearInterval(intervalId);
                  return;
                }
                let astroStatus = await Astrologer.findOne({ _id: astrologer1?._id }).select("status");
                if (astroStatus?.status == "available") {
                  await call_reminder(
                    astrologer1?.phone_number,
                    astrologer1?._id,
                    20,
                  );
                  // console.log("callremainder name", call_reminder)
                  // console.log("callremainder name", call_reminder.name)
                }
              }, 35000);
            } else {
              await call_reminder(
                astrologer1?.phone_number,
                astrologer1?._id,
                20,
              );
            }

          }
        } catch (error) {
          logger.error(`Error notifying astrologer ${astrologer?.astrologerId}:`, error);
        }
      })
    );
    // console.log("Queue saved successfully with new astrologers assigned.");

    return queue;
  } catch (err) {
    console.error("Error assigning astrologers to queue:", err);
    throw err;
  }
}


module.exports = {
  cleanUpOldTransactions,
  preferredTimeEveryFifteenMinutes,
  historyMsgsToAwsS3Bucket,
  endingPendingChats,
}
