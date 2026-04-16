const Razorpay = require('razorpay');
const { env } = require('./env');

const razorpay = new Razorpay({
  key_id: env.razorpayKeyId,
  key_secret: env.razorpayKeySecret,
});

module.exports = razorpay;
