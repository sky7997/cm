const mongoose = require("mongoose");
require("mongoose-double")(mongoose);

const Schema = mongoose.Schema;

const Transaction = new mongoose.Schema(
    {
        user: {
            type: Schema.Types.ObjectId,
            ref: "User",
        },
        astrologer: {
            type: Schema.Types.ObjectId,
            ref: "Astrologer",
        },
        date: {
            type: Date,
            default: Date.now,
        },
        status: {
            type: String,
            enum: ['pending', 'success', 'failure', 'created', "attempted"],
            default: 'pending',
        },
        amount: {
            type: Number,
            required: false,
        },
        signature: {
            type: String,
            required: false,
        },
        orderId: {
            type: String,
            required: false,
        },
        type: {
            type: String,
            enum: ["credit", "debit"],
        },
        transactionId: String,
        paymentId: String,
        transaction_reference_id: String,
        description: {
            type: String,
        },
        couponCode: {
            type: String,
        },
        couponAmount: {
            type: Number,
        },
        percentage: {
            type: Boolean,
        },
    },
    {
        timestamps: true,
    },
);

module.exports = mongoose.model("Transaction", Transaction);





const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const userSchema = new Schema(
    {
        userName: {
            type: String,
            required: true,
        },
        phone_number: {
            type: String,
            required: true,
        },
        otp: {
            type: String,
            maxlength: 4,
            minlength: 4,
        },
        dob: {
            type: Date,
        },
        gender: {
            type: String,
        },
        place_of_birth: {
            type: String,
        },
        time_of_birth: {
            type: String,
        },
        address1: {
            type: String,
        },
        address2: {
            type: String,
        },
        pincode: {
            type: Number,
        },
        wallet: {
            type: Number,
            default: 0,
        },
        fcmToken: {
            type: String,
        },
        isChatConnected: {
            type: Boolean,
            default: false,
        },
        isFree: {
            type: Boolean,
            default: true,
        },
        spins: {
            type: Number,
            default: 3,
        },
        globalCoupons: [
            {
                code: {
                    type: String,
                    required: true,
                },
            },
        ],
        newUser: {
            type: Boolean,
            default: true,
        },
        referralCode: {
            type: String,
            unique: true
        },
        userPreference: {
            type: [],
        },
        zodiac_sign: {
            type: String,
        },
        userWalletOnHold: {
            type: Boolean,
            default: false
        },
        isActive: {
            type: Boolean,
            default: true
        },
    },
    { timestamps: true },
);
module.exports = mongoose.model("User", userSchema);





const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const availableAstrologers = {
  astrologerId: {
    type: Schema.Types.ObjectId,
    ref: "Astrologer",
  },
}

const count = new Schema(
  {
    count: {
      type: Number,
    },
    causedBy: {
      type: String,
      enum: ["User", "Astrologer"],
    },
  },
  {
    timestamps: true,
  },
);

const Queue = mongoose.Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    userName: {
      type: String,
    },
    known_languages: {
      type: String,
    },
    from: {
      type: String,
    },
    to: {
      type: String,
    },
    type: {
      type: String,
    },
    date: {
      type: Date,
      default: Date.now(),
    },
    time: {
      type: String,
    },
    astrologerId: {
      type: Schema.Types.ObjectId,
      ref: "Astrologer",
    },
    prevAstrologerId: { 
      type: Schema.Types.ObjectId, 
      ref: "Astrologer", 
    },
    time_duration: {
      type: String,
    },
    channelRoomId: {
      type: String,
      default: "channel",
    },
    gender: {
      type: String,
    },
    place_of_birth: {
      type: String,
    },
    dob: {
      type: String,
    },
    tob: {
      type: String,
    },
    cost: {
      type: String,
    },
    status: {
      type: String,
      enum: ["waiting", "waiting for user", "live", "session end", "expired", "hold", "missed", "cancelled", "missed chat", "failed"],
      default: "waiting",
    },
    walletTransactionIds: [{
      type: Schema.Types.ObjectId,
      ref: "WalletTransactions"
    }],
    assignedAstrologer: {
      type: Schema.Types.ObjectId,
      ref: "Astrologer",
    },
    availableAstrologers: [availableAstrologers],
    unAssignedAstrologers: [availableAstrologers],
    websocketIssueCount: [count],
    discount: {
      type: String,
    },
    waitingTime: {
      type: Date,
    },
    failReason: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);
module.exports = mongoose.model("Queue", Queue);






const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const queueBucketsSchema = new Schema(
    {
        bucketNumber: {
            type: Number,
            required: true,
            index: true,
        },
        env: {
            type: String,
            enum: ["DEVELOPMENT", "PRODUCTION", "TESTING", "DEVELOPMENT_"],
            default: "DEVELOPMENT",
        },
        bucketStatus: {
            type: String,
            enum: ["available", "busy", "waiting"],
            default: "available",
        },
        availableAstrologers: [{
            type: Schema.Types.ObjectId,
            ref: 'Astrologer',
            default: [],
        }],
        busyAstrologerIds: [{ // add accepted astrologer id when complete remove
            type: Schema.Types.ObjectId,
            ref: 'Astrologer',
            default: [],
        }],
        offlineAstrologerIds: [{ // add offline astrologer id when they turn off their duty
            type: Schema.Types.ObjectId,
            ref: 'Astrologer',
            default: [],
        }],
        lastPicked: [{ // add accepted astrologer id, when next order come don't pass last picked astrologer give chance to  other one
            type: Schema.Types.ObjectId,
            ref: 'Astrologer',
            default: [],
        }],
        availableAstrologerIds: [{ // make list of available astrologers ids
            type: Schema.Types.ObjectId,
            ref: 'Astrologer',
            default: [],
        }]
    },
    {
        timestamps: true,
    },
)

const QueueBuckets = mongoose.model("QueueBuckets", queueBucketsSchema);

module.exports = QueueBuckets;




const mongoose = require("mongoose");
require("mongoose-double")(mongoose);

const Schema = mongoose.Schema;

const MessageSchema = new Schema(
    {
        senderId: String,
        message: String,
        receiverId: {
            type: String,
        },
        type: {
            type: String,
            enum: ["text", "image", "audio", "error"],
            default: "text",
        },
        delivered: {
            type: Boolean,
            default: false
        },
        read: {
            type: Boolean,
            default: false
        },
    },
    {
        timestamps: true,
    }
);

const Chatroom = mongoose.Schema(
    {
        chatroomName: {
            type: String,
        },
        chatroomId: {
            type: String,
        },
        user: {
            type: Schema.Types.ObjectId,
            ref: "User",
        },
        astrologer: {
            type: Schema.Types.ObjectId,
            ref: "Astrologer",
        },
        messages: [MessageSchema],
        msgsToAwsS3BucketUrl : {
            type: String,
        },
        offlineMessages: [
            {
                senderId: { type: String },
                receiverId: { type: String },
                message: { type: String },
                delivered: { type: Boolean, default: false },
                read: { type: Boolean, default: false },
            },
            {
                timestamps: true,
            },
        ],
    },
    {
        timestamps: true,
    },
);

module.exports = mongoose.model("Chatroom", Chatroom);
