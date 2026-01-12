const { sendRestaurantOrderNotification, sendCustomerOrderConfirmation } = require('./whatsapp');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      message: 'D818 API is running!'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const order = req.body;

  if (!order || !order.orderId) {
    return res.status(400).json({
      success: false,
      error: 'Invalid order data'
    });
  }

  try {
    // Send email to restaurant
    await sendRestaurantEmail(order);

    // Wait 1 second to avoid Resend rate limit (free plan: 2 emails/sec)
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Send confirmation email to customer (if email provided)
    if (order.user?.email) {
      await sendCustomerEmail(order);
    }

    // Send WhatsApp notifications
    await sendRestaurantOrderNotification(order);

    if (order.user?.phone) {
      await sendCustomerOrderConfirmation(order);
    }

    console.log('✅ Order received:', order.orderId);

    return res.status(200).json({
      success: true,
      orderId: order.orderId,
      message: 'Order received! Notifications sent via email and WhatsApp.'
    });
  } catch (error) {
    console.error('❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process order',
      details: error.message
    });
  }
}

// EMAIL TO RESTAURANT
async function sendRestaurantEmail(order) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const YOUR_EMAIL = process.env.YOUR_EMAIL;

  if (!RESEND_API_KEY || !YOUR_EMAIL) {
    console.log('⚠️ Email not configured - check RESEND_API_KEY and YOUR_EMAIL');
    return;
  }

  // Build items list
  let itemsList = '';
  if (order.items) {
    order.items.forEach(item => {
      itemsList += `<tr>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.name}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">£${(item.price * item.quantity).toFixed(2)}</td>
      </tr>`;
    });
  }

  const deliveryType = (order.deliveryOption || 'collection').toUpperCase();
  const isUber = order.deliveryOption === 'uber';
  const deliveryInfo = order.deliveryDetails
    ? `<div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 15px 0;">
        <p style="margin: 5px 0;"><strong>📍 Address:</strong> ${order.deliveryDetails.address || 'N/A'}</p>
        <p style="margin: 5px 0;"><strong>📮 Postcode:</strong> ${order.deliveryDetails.postcode || 'N/A'}</p>
        <p style="margin: 5px 0;"><strong>📞 Phone:</strong> ${order.deliveryDetails.phone || order.user?.phone || 'N/A'}</p>
        ${order.deliveryDetails.notes ? `<p style="margin: 5px 0;"><strong>📝 Notes:</strong> ${order.deliveryDetails.notes}</p>` : ''}
      </div>`
    : '';

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #f97316; color: white; padding: 20px; text-align: center;">
        <h1 style="margin: 0;">🔔 NEW ORDER RECEIVED!</h1>
      </div>

      <div style="padding: 20px; background: #fff;">
        <div style="background: #fff7ed; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 2px solid #f97316;">
          <h2 style="color: #f97316; margin: 0;">Order #${order.orderId}</h2>
          <p style="color: #666; margin: 5px 0; font-size: 14px;">⏰ ${new Date(order.timestamp).toLocaleString('en-GB', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}</p>
        </div>

        <div style="background: ${isUber ? '#dbeafe' : deliveryType === 'DELIVERY' ? '#dcfce7' : '#fef3c7'}; padding: 15px; border-radius: 8px; margin: 15px 0;">
          <h3 style="margin: 0; color: #333;">
            ${isUber ? '🚗 UBER DELIVERY (Customer Arranged)' :
              deliveryType === 'DELIVERY' ? '🚚 DELIVERY ORDER' :
              '📦 COLLECTION ORDER'}
          </h3>
          ${isUber ? '<p style="margin: 5px 0; color: #1e40af;"><strong>⚠️ Customer will send Uber driver with Order ID</strong></p>' : ''}
        </div>

        <h3 style="color: #333; border-bottom: 2px solid #f97316; padding-bottom: 5px;">👤 Customer Details</h3>
        <p style="margin: 5px 0;"><strong>Name:</strong> ${order.user?.name || 'Guest'}</p>
        <p style="margin: 5px 0;"><strong>Phone:</strong> ${order.user?.phone || order.deliveryDetails?.phone || 'Not provided'}</p>
        <p style="margin: 5px 0;"><strong>Email:</strong> ${order.user?.email || 'Not provided'}</p>

        ${deliveryInfo}

        <h3 style="color: #333; border-bottom: 2px solid #f97316; padding-bottom: 5px;">🍽️ Order Items</h3>
        <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
          <thead>
            <tr style="background: #f3f4f6;">
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Item</th>
              <th style="padding: 10px; text-align: center; border-bottom: 2px solid #ddd;">Qty</th>
              <th style="padding: 10px; text-align: right; border-bottom: 2px solid #ddd;">Price</th>
            </tr>
          </thead>
          <tbody>
            ${itemsList}
          </tbody>
        </table>

        <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 15px 0;">
          <div style="display: flex; justify-content: space-between; margin: 5px 0;">
            <span>Subtotal:</span>
            <strong>£${order.subtotal}</strong>
          </div>
          ${order.deliveryFee !== '0.00' ? `
            <div style="display: flex; justify-content: space-between; margin: 5px 0;">
              <span>Delivery Fee:</span>
              <strong style="color: #f97316;">£${order.deliveryFee}</strong>
            </div>
          ` : ''}
        </div>

        <div style="margin-top: 20px; padding: 20px; background: #f97316; color: white; border-radius: 8px; text-align: center;">
          <h2 style="margin: 0; font-size: 32px;">TOTAL: £${order.total}</h2>
          ${order.paymentStatus === 'paid' ? '<p style="margin: 5px 0;">✅ PAYMENT RECEIVED</p>' : '<p style="margin: 5px 0;">⚠️ Payment Pending</p>'}
        </div>

        ${!order.withinRadius && deliveryType === 'DELIVERY' ? `
          <div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin: 15px 0; border: 2px solid #fbbf24;">
            <p style="margin: 0; color: #92400e;"><strong>⚠️ OUTSIDE DELIVERY AREA - CALL CUSTOMER</strong></p>
          </div>
        ` : ''}
      </div>

      <div style="background: #1f2937; color: #9ca3af; padding: 15px; text-align: center;">
        <p style="margin: 0;">D818 Restaurant - Nottingham | 📞 0784662910</p>
      </div>
    </div>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'D818 Orders <info@d818.co.uk>',
      to: YOUR_EMAIL,
      subject: `🔔 NEW ORDER #${order.orderId} - £${order.total} - ${deliveryType}`,
      html: emailHtml
    })
  });

  // Send WhatsApp notification to restaurant
  const whatsappMessage = `🍽️ NEW ORDER: ${order.orderId}
Customer: ${order.user?.name || 'Guest'}
Phone: ${order.user?.phone || 'N/A'}
Items: ${order.items?.map(item => `${item.quantity}x ${item.name}`).join(', ')}
Total: £${order.total}
Type: ${order.deliveryOption}
Time: ${new Date().toLocaleString('en-GB')}`;

  // Send to WhatsApp (replace YOUR_PHONE_NUMBER with your actual number)
  const whatsappUrl = `https://wa.me/447846629100?text=${encodeURIComponent(whatsappMessage)}`;
  console.log('📱 WhatsApp notification ready:', whatsappUrl);

  if (!response.ok) {
    const error = await response.text();
    console.error('❌ Restaurant email error:', error);
    throw new Error(`Failed to send restaurant email: ${error}`);
  } else {
    console.log('✅ Restaurant email sent!');
  }
}

// EMAIL TO CUSTOMER
async function sendCustomerEmail(order) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!RESEND_API_KEY) {
    console.log('⚠️ Skipping customer email');
    return;
  }

  let itemsList = '';
  if (order.items) {
    order.items.forEach(item => {
      itemsList += `<tr>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.name}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">£${(item.price * item.quantity).toFixed(2)}</td>
      </tr>`;
    });
  }

  const deliveryType = order.deliveryOption || 'collection';
  const isUber = deliveryType === 'uber';
  const isDelivery = deliveryType === 'delivery';
  const isCollection = deliveryType === 'collection';

  const customerEmailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #f97316; color: white; padding: 20px; text-align: center;">
        <h1 style="margin: 0;">🎉 Order Confirmed!</h1>
      </div>

      <div style="padding: 20px; background: #fff;">
        <p style="font-size: 18px;">Hi ${order.user?.name || 'there'},</p>
        <p>Thank you for your order! We're preparing your delicious meal right now. 🍽️</p>

        <div style="background: #fff7ed; padding: 15px; border-radius: 8px; margin: 20px 0; border: 2px solid #f97316;">
          <h2 style="color: #f97316; margin: 0;">Order #${order.orderId}</h2>
          <p style="color: #666; margin: 5px 0;">⏰ ${new Date(order.timestamp).toLocaleString('en-GB')}</p>
          <p style="margin: 10px 0;"><strong>Status:</strong> <span style="color: #16a34a;">✅ Being Processed</span></p>
        </div>

        ${isCollection ? `
          <div style="background: #dbeafe; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <h3 style="margin: 0; color: #1e40af;">📦 COLLECTION ORDER</h3>
            <p style="margin: 10px 0;">Your order will be ready for pickup in <strong>30-45 minutes</strong></p>
            <p style="margin: 5px 0;"><strong>📍 Location:</strong> D818 Restaurant, Nottingham</p>
            <p style="margin: 5px 0;"><strong>📞 Call us:</strong> 0784662910</p>
          </div>
        ` : ''}

        ${isDelivery && !isUber ? `
          <div style="background: #dcfce7; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <h3 style="margin: 0; color: #16a34a;">🚚 DELIVERY ORDER</h3>
            <p style="margin: 10px 0;">Your order will arrive in <strong>45-60 minutes</strong></p>
            <p style="margin: 5px 0;"><strong>📍 Delivering to:</strong> ${order.deliveryDetails?.address}, ${order.deliveryDetails?.postcode}</p>
          </div>
        ` : ''}

        ${isUber ? `
          <div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin: 15px 0; border: 2px solid #fbbf24;">
            <h3 style="margin: 0; color: #92400e;">🚗 UBER DELIVERY - ACTION REQUIRED</h3>
            <p style="margin: 10px 0;"><strong>Next Steps:</strong></p>
            <ol style="margin: 10px 0; padding-left: 20px;">
              <li>Open your Uber app</li>
              <li>Request a ride to: <strong>D818 Restaurant, Nottingham</strong></li>
              <li>Give the driver this Order ID: <strong style="font-size: 20px; color: #f97316;">${order.orderId}</strong></li>
              <li>We'll hand your order to the driver</li>
            </ol>
            <p style="margin: 10px 0; color: #92400e;"><strong>⚠️ Your order will be ready in 30-45 minutes</strong></p>
          </div>
        ` : ''}

        <h3 style="color: #333; border-bottom: 2px solid #f97316; padding-bottom: 5px;">🍽️ Your Order</h3>
        <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
          <thead>
            <tr style="background: #f3f4f6;">
              <th style="padding: 10px; text-align: left;">Item</th>
              <th style="padding: 10px; text-align: center;">Qty</th>
              <th style="padding: 10px; text-align: right;">Price</th>
            </tr>
          </thead>
          <tbody>
            ${itemsList}
          </tbody>
        </table>

        <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 15px 0;">
          <div style="display: flex; justify-content: space-between; margin: 5px 0;">
            <span>Subtotal:</span>
            <strong>£${order.subtotal}</strong>
          </div>
          ${order.deliveryFee !== '0.00' ? `
            <div style="display: flex; justify-content: space-between; margin: 5px 0;">
              <span>Delivery Fee:</span>
              <strong style="color: #f97316;">£${order.deliveryFee}</strong>
            </div>
          ` : ''}
          <div style="display: flex; justify-content: space-between; margin: 15px 0 5px 0; padding-top: 10px; border-top: 2px solid #ddd;">
            <span style="font-size: 20px;"><strong>Total:</strong></span>
            <span style="font-size: 24px; color: #f97316;"><strong>£${order.total}</strong></span>
          </div>
        </div>

        <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h4 style="margin: 0 0 10px 0;">Need Help?</h4>
          <p style="margin: 5px 0;">📞 <strong>Phone:</strong> 0784662910</p>
          <p style="margin: 5px 0;">📧 <strong>Email:</strong> hello@d818.co.uk</p>
          <p style="margin: 5px 0;">🆔 <strong>Your Order ID:</strong> ${order.orderId}</p>
        </div>

        <p style="margin-top: 20px; text-align: center; color: #666;">
          Thank you for choosing D818! 🙏<br/>
          <em>Authentic Afro-Caribbean Cuisine</em>
        </p>
      </div>

      <div style="background: #1f2937; color: #9ca3af; padding: 15px; text-align: center;">
        <p style="margin: 0;">D818 Restaurant - Nottingham</p>
      </div>
    </div>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'D818 Restaurant <info@d818.co.uk>',
      to: order.user.email,
      subject: `✅ Order Confirmed #${order.orderId} - D818 Restaurant`,
      html: customerEmailHtml
    })
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('❌ Customer email error:', error);
  } else {
    console.log('✅ Customer email sent!');
  }
}
F