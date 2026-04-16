const { Expo } = require('expo-server-sdk');

let expo = new Expo();

exports.sendPushNotification = async (pushToken, title, body, data = {}) => {
  if (!Expo.isExpoPushToken(pushToken)) {
    console.error(`Push token ${pushToken} is not a valid Expo push token`);
    return;
  }

  const messages = [{
    to: pushToken,
    sound: 'default',
    title: title,
    body: body,
    data: data,
  }];

  try {
    const receipts = await expo.sendPushNotificationsAsync(messages);
    console.log('Push notification sent:', receipts);
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
};
