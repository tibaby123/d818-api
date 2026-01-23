// whatsapp.js
const sendWhatsAppMessage = async (phoneNumber, message) => {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  
  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phoneNumber.replace(/\D/g, ''), // Remove non-digits
      text: {
        body: message
      }
    })
  });

  return response.json();
};

// Send order notification to restaurant
const sendRestaurantOrderNotification = async (order) => {
  const restaurantPhone = '447846629100'; // Your WhatsApp number
  
  const message = `🍽️ NEW ORDER - D818 Restaurant
  
Order ID: ${order.orderId}
Customer: ${order.user.name}
Phone: ${order.user.phone}
Email: ${order.user.email}

Items:
${order.items.map(item => `• ${item.quantity}x ${item.name} - £${item.price}`).join('\n')}

Delivery: ${order.deliveryOption.toUpperCase()}
${order.deliveryDetails ? `Address: ${order.deliveryDetails.address}\nPostcode: ${order.deliveryDetails.postcode}` : ''}

Total: £${order.total}
Payment: ${order.paymentStatus}

Time: ${new Date(order.timestamp).toLocaleString()}`;

  try {
    await sendWhatsAppMessage(restaurantPhone, message);
    console.log('✅ WhatsApp notification sent to restaurant');
  } catch (error) {
    console.error('❌ WhatsApp notification failed:', error);
  }
};

// Send confirmation to customer
const sendCustomerOrderConfirmation = async (order) => {
  if (!order.user.phone) return;
  
  const customerPhone = order.user.phone.replace(/\D/g, '');
  
  const message = `🎉 Order Confirmed - D818 Restaurant

Hi ${order.user.name}!

Order ID: ${order.orderId}
Total: £${order.total}
Type: ${order.deliveryOption.toUpperCase()}

${order.deliveryOption === 'delivery' ? 
  `📍 Delivery to: ${order.deliveryDetails?.address}
⏰ Expected: 30-45 minutes` : 
  `📍 Collection from: [Your Restaurant Address]
⏰ Ready in: 20-30 minutes`}

We'll notify you when your order is ready!

Questions? Call us: 0784662910
Website: d818.co.uk`;

  try {
    await sendWhatsAppMessage(customerPhone, message);
    console.log('✅ WhatsApp confirmation sent to customer');
  } catch (error) {
    console.error('❌ Customer WhatsApp failed:', error);
  }
};

module.exports = {
  sendRestaurantOrderNotification,
  sendCustomerOrderConfirmation
};
