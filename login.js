const axios = require('axios')

require("dotenv").config()
const express = require('express')
const router = express.Router()
var User = require('../models/User')




const {
  sendOTP,
  //  AwsSendOTP
} = require('../utils/otp')
var jwt = require('jsonwebtoken')
const logger = require('../Logger')

let getXmlValue = function (str, key) {
  return str.substring(
    str?.lastIndexOf('<' + key + '>') + ('<' + key + '>').length,
    str?.lastIndexOf('</' + key + '>')
  )
}






//old
router.post('/send-otp', async (req, res) => {
  logger.info('Execute send Otp Api')
  // logger.info(process.env.NODE_ENV, "here");
  let { phone_number, app_signature } = req.body
  logger.debug('line 18 request body', req.body)
  // logger.info(app_signature + "APP SIGGY")
  if (!phone_number) {
    return res.status(400).send('Please provide a mobile number')
  }

  if (phone_number.length != 10) {
    logger.info('Please provide a valid Mobile Number')
    return res.status(400).send('Please provide a valid mobile number')
  }

  const authorizedPhoneNumbers = process.env.AUTHORIZED_PHONE_NUMBERS.split(',')
  if (!authorizedPhoneNumbers.includes(phone_number)) {
    return res.status(400).send('Unauthorized personal')
  }

  try {
    let user = await User.findOne({ phone_number: phone_number })

    let otp = Math.floor(1000 + Math.random() * 9000)
    logger.info(`Phone Number: ${phone_number}, OTP: ${otp}`)

    try {
      if (process.env.NODE_ENV === 'development') {
        if (user) {
          user.otp = otp
          await user.save()
          logger.info('Otp Sent is successfully!')

          return res.status(200).send({
            message: 'OTP sent',
            contact: phone_number,
            userExists: true,
          })
        } else {
          logger.info('Un Authorized User')
          return res.status(400).send({
            message: 'Un Authorized user',
          })
        }
      }

      let data = await sendOTP(phone_number, otp, app_signature)
      let parsedData = getXmlValue(data, 'Status')

      // let sendOtpAWS = await AwsSendOTP(phone_number, otp,"IN", app_signature);
      // let parsedDataAWS = getXmlValue(sendOtpAWS, "Status");

      if (parsedData == 'queued') {
        if (user) {
          user.otp = otp
          await user.save()
          logger.info('Un Authorized user')
          return res.status(200).send({
            message: 'OTP sent',
            contact: phone_number,
            userExists: true,
          })
        } else {
          logger.info('Un Authorized user')
          return res.status(400).send({
            message: 'un Authorized user',
          })
        }
      } else {
        logger.error('Error Sending Otp..')
        return res.status(400).send('Error sending OTP')
      }
    } catch (err) {
      logger.error('Error sending Otp', err)
      return res.status(400).send(err)
    }
  } catch (err) {
    logger.error('Error Sending Otp')
    return res.status(500).send(err)
  }
})


//old
router.post('/otp-verify', async (req, res) => {
  logger.info('Execute  Otp Verify Api')
  try {
    let { phone_number, otp } = req.body
    if (!phone_number) {
      logger.info('Please Provide a phone Number')
      return res.status(400).send('Please provide a phone_number')
    }
    if (!otp) {
      logger.info('please Provide Otp')
      return res.status(400).send('Please provide otp')
    }
    //check if user exists
    let user = await User.findOne({ phone_number: phone_number })
    if (!user) {
      logger.info('User Does Not Exist!..')
      return res.status(400).send('User does not exist')
    }
    if (user.otp != otp || user.otp === '' || user.otp === null) {
      logger.info('Otp does Not Match')
      return res.status(400).send('OTP does not match')
    }
    const authorizedPhoneNumbers =
      process.env.AUTHORIZED_PHONE_NUMBERS.split(',')
    if (!authorizedPhoneNumbers.includes(phone_number)) {
      logger.info('Unauthorized personal')
      return res.status(400).send('Unauthorized personal')
    }
    const payload = {
      phone_number: phone_number,
      company_id: phone_number,
    }

    // eslint-disable-next-line no-unused-vars
    const token = jwt.sign(
      payload,
      process.env.SECRET_OR_KEY,
      {
        expiresIn: 31556926, // 1 year in seconds
      },
      (err, token) => {
        if (err) {
          logger.error('Some error is encountered')
          return res.status(500).send('Some error is encountered')
        }
        logger.info('User Logged Successfully')
        return res.status(200).json({
          success: 'User logged in',
          token: token,
          user: {
            phone_number: user.contact,
            company_id: user.company_id,
            userName: user.userName,
            dob: user.dob,
            gender: user.gender,
            joined_at: user?.createdAt || '',
            profilePic: user.profilePic || '',
            age: user?.age || '',
          },
          newLogin: false,
        })
      }
    )
  } catch (err) {
    logger.error('Error: otp verify failed', err?.message ?? '')
    return res.status(500).send('Error logging in')
  }
})




module.exports = router
