import Stripe from "stripe";
import { Resend } from "resend";

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  console.log("🔔 Webhook received");
  
  if (req.method !== "POST") {
    return res.status(405).end("Method Not Allowed");
  }

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");

    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    
    console.log("✅ Signature verified");
    console.log("📦 Event type:", event.type);
    console.log("🆔 Event ID:", event.id);
    
  } catch (err) {
    console.error("❌ Webhook signature verification failed:", err.message);
    return res.status(400).json({ error: err.message });
  }

  try {
    if (event.type === "checkout.session.completed") {
      console.log("💳 Processing checkout.session.completed");
      
      const session = event.data.object;
      console.log("Session ID:", session.id);
      console.log("Payment status:", session.payment_status);

      if (session.payment_status !== "paid") {
        console.log("⚠️ Payment not completed, skipping");
        return res.json({ received: true });
      }

      const orderId = session.client_reference_id || session.metadata?.orderId;
      const totalPaid = (session.amount_total || 0) / 100;
      
      console.log("📝 Order ID:", orderId);
      console.log("💰 Total paid: £", totalPaid);

      // De-dupe check
      const paymentIntentId = session.payment_intent;
      if (paymentIntentId) {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (pi?.metadata?.d818_email_sent === "true") {
          console.log("ℹ️ Emails already sent for this PaymentIntent. Skipping.");
          await sendPaymentConfirmation(orderId, totalPaid);
          return res.json({ received: true });
        }
      }

      // Pull line items
      console.log("📋 Fetching line items...");
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
      console.log("Found", lineItems.data.length, "line items");

      // Compute delivery fee
      const deliveryFeeItem = lineItems.data.find(
        (li) => (li.description || "").toLowerCase().trim() === "delivery fee"
      );
      const deliveryFee = deliveryFeeItem ? (deliveryFeeItem.amount_total || 0) / 100 : 0;
      const subtotal = Math.max(0, totalPaid - deliveryFee);

      console.log("💵 Subtotal: £", subtotal);
      console.log("🚚 Delivery fee: £", deliveryFee);

      // Build items list
      const items = lineItems.data
        .filter((li) => (li.description || "").toLowerCase().trim() !== "delivery fee")
        .map((li) => {
          const qty = Number(li.quantity || 1);
          const total = (li.amount_total || 0) / 100;
          const unit = qty > 0 ? total / qty : total;

          return {
            name: li.description,
            quantity: qty,
            price: Number(unit.toFixed(2)),
          };
        });

      console.log("🍽️ Order items:", items.length);

      // Build order object
      const order = {
        orderId,
        user: {
          name: session.metadata?.customerName || "Guest",
          phone: session.metadata?.phone || "",
          email: session.customer_details?.email || session.metadata?.customerEmail || "",
        },
        items,
        deliveryOption: session.metadata?.deliveryOption || "collection",
        subtotal: subtotal.toFixed(2),
        deliveryFee: deliveryFee.toFixed(2),
        total: totalPaid.toFixed(2),
        deliveryDetails:
          (session.metadata?.deliveryOption || "collection") !== "collection"
            ? {
                address: session.metadata?.address || "",
                postcode: session.metadata?.postcode || "",
                notes: session.metadata?.notes || "",
                phone: session.metadata?.phone || "",
                email: session.customer_details?.email || session.metadata?.customerEmail || "",
              }
            : null,
        withinRadius:
          session.metadata?.withinRadius === "true" ||
          session.metadata?.withinRadius === true ||
          session.metadata?.withinRadius === "1" ||
          true,
        timestamp: new Date().toISOString(),
        paymentMethod: "stripe",
        paymentId: paymentIntentId || session.id,
        paymentStatus: "paid",
      };

      console.log("👤 Customer:", order.user.name, order.user.email);
      console.log("🚚 Delivery option:", order.deliveryOption);

      // Send restaurant email
      console.log("📧 Sending restaurant email to info@d818.co.uk...");
      await resend.emails.send({
        from: "D818 Orders <onboarding@resend.dev>",
        to: "info@d818.co.uk",
        replyTo: order.user.email || undefined,
        subject: `🍽️ New Order: ${order.orderId}`,
        html: restaurantEmailHtml(order),
      });
      console.log("✅ Restaurant email sent");

      // Send customer email
      if (order.user.email) {
        console.log("📧 Sending customer email to", order.user.email);
        await resend.emails.send({
          from: "D818 Restaurant <onboarding@resend.dev>",
          to: order.user.email,
          replyTo: "info@d818.co.uk",
          subject: `✅ Order Confirmation - ${order.orderId}`,
          html: customerEmailHtml(order),
        });
        console.log("✅ Customer email sent");
      } else {
        console.log("⚠️ No customer email provided");
      }

      // Mark as sent
      if (paymentIntentId) {
        console.log("🏷️ Marking PaymentIntent as processed...");
        await stripe.paymentIntents.update(paymentIntentId, {
          metadata: {
            d818_email_sent: "true",
            d818_order_id: String(orderId || ""),
          },
        });
        console.log("✅ PaymentIntent marked as processed");
      }

      // WhatsApp confirmation
      console.log("📱 Sending WhatsApp confirmation...");
      await sendPaymentConfirmation(orderId, totalPaid);
      console.log("✅ WhatsApp sent");
      
      console.log("🎉 Order processed successfully:", orderId);
    } else {
      console.log("ℹ️ Unhandled event type:", event.type);
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("❌ Webhook handler error:", err);
    console.error("Error details:", err.message);
    console.error("Stack trace:", err.stack);
    return res.status(500).json({ error: "Webhook handler failed" });
  }
}

// ----------------------
// SAME EMAIL TEMPLATES AS orders.js
// ----------------------

function restaurantEmailHtml(order) {
  return `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              line-height: 1.6; 
              color: #333; 
              margin: 0;
              padding: 0;
              background-color: #f3f4f6;
            }
            .container { 
              max-width: 600px; 
              margin: 20px auto; 
              background: white;
              border-radius: 8px;
              overflow: hidden;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .header { 
              background: #f97316; 
              color: white; 
              padding: 30px 20px; 
              text-align: center; 
            }
            .header h1 {
              margin: 0;
              font-size: 28px;
            }
            .content { 
              padding: 30px 20px; 
            }
            .order-id { 
              background: #fef3c7; 
              padding: 20px; 
              border-left: 4px solid #f59e0b; 
              margin: 20px 0;
              border-radius: 4px;
            }
            .order-id strong {
              color: #92400e;
            }
            .section { 
              margin: 25px 0; 
              padding: 20px; 
              background: #f9fafb; 
              border-radius: 8px;
              border: 1px solid #e5e7eb;
            }
            .section h2 {
              margin-top: 0;
              color: #1f2937;
              font-size: 18px;
              border-bottom: 2px solid #f97316;
              padding-bottom: 10px;
            }
            .section p {
              margin: 8px 0;
            }
            .item { 
              padding: 12px; 
              border-bottom: 1px solid #e5e7eb;
              display: flex;
              justify-content: space-between;
              align-items: center;
            }
            .item:last-child {
              border-bottom: none;
            }
            .item-name {
              font-weight: 600;
              color: #374151;
            }
            .item-quantity {
              color: #6b7280;
              font-size: 14px;
            }
            .item-price {
              font-weight: bold;
              color: #f97316;
            }
            .total-section {
              margin-top: 20px;
              padding: 15px;
              background: white;
              border-radius: 8px;
            }
            .total-row {
              display: flex;
              justify-content: space-between;
              padding: 8px 0;
              font-size: 16px;
            }
            .total-final {
              background: #fef3c7;
              padding: 15px;
              margin-top: 10px;
              border-radius: 8px;
              font-size: 20px;
              font-weight: bold;
              display: flex;
              justify-content: space-between;
              color: #92400e;
            }
            .badge { 
              display: inline-block; 
              padding: 6px 12px; 
              border-radius: 20px; 
              font-size: 13px; 
              font-weight: bold;
              text-transform: uppercase;
            }
            .badge-delivery { 
              background: #dbeafe; 
              color: #1e40af; 
            }
            .badge-collection { 
              background: #d1fae5; 
              color: #065f46; 
            }
            .badge-uber { 
              background: #e0e7ff; 
              color: #3730a3; 
            }
            .alert-warning {
              background: #fef2f2;
              border: 2px solid #dc2626;
              padding: 15px;
              border-radius: 8px;
              color: #991b1b;
              font-weight: bold;
              margin: 15px 0;
            }
            .payment-success {
              background: #d1fae5;
              padding: 15px;
              border-radius: 8px;
              color: #065f46;
              font-weight: bold;
              text-align: center;
              margin: 15px 0;
            }
            .footer {
              background: #f3f4f6;
              padding: 20px;
              text-align: center;
              color: #6b7280;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🍽️ New Order Received!</h1>
            </div>
            
            <div class="content">
              <div class="order-id">
                <p style="margin: 0;"><strong>Order ID:</strong> ${order.orderId}</p>
                <p style="margin: 5px 0 0 0;"><strong>Time:</strong> ${new Date(order.timestamp).toLocaleString('en-GB', { 
                  dateStyle: 'full', 
                  timeStyle: 'short' 
                })}</p>
              </div>

              <div class="payment-success">
                ✅ PAYMENT CONFIRMED - ${order.paymentMethod?.toUpperCase() || 'PAID'}
              </div>

              <div class="section">
                <h2>👤 Customer Information</h2>
                <p><strong>Name:</strong> ${order.user.name}</p>
                <p><strong>Email:</strong> <a href="mailto:${order.user.email}" style="color: #f97316;">${order.user.email}</a></p>
                <p><strong>Phone:</strong> <a href="tel:${order.deliveryDetails?.phone || order.user.phone || ''}" style="color: #f97316;">${order.deliveryDetails?.phone || order.user.phone || 'N/A'}</a></p>
              </div>

              <div class="section">
                <h2>🚚 Delivery Information</h2>
                <p>
                  <span class="badge ${
                    order.deliveryOption === 'uber' ? 'badge-uber' : 
                    order.deliveryOption === 'delivery' ? 'badge-delivery' : 
                    'badge-collection'
                  }">
                    ${order.deliveryOption === 'uber' ? '🚗 Uber Delivery' : 
                      order.deliveryOption === 'delivery' ? '🚚 Home Delivery' : 
                      '🏪 Collection'}
                  </span>
                </p>
                
                ${order.deliveryDetails && order.deliveryOption !== 'collection' ? `
                  <p style="margin-top: 15px;"><strong>📍 Delivery Address:</strong></p>
                  <p style="margin: 5px 0; padding-left: 10px; border-left: 3px solid #f97316;">
                    ${order.deliveryDetails.address}<br/>
                    ${order.deliveryDetails.postcode}
                  </p>
                  
                  ${order.deliveryDetails.notes ? `
                    <p style="margin-top: 15px;"><strong>📝 Customer Notes:</strong></p>
                    <p style="background: #fffbeb; padding: 10px; border-radius: 5px; margin: 5px 0;">
                      ${order.deliveryDetails.notes}
                    </p>
                  ` : ''}
                  
                  ${!order.withinRadius && order.deliveryOption === 'delivery' ? `
                    <div class="alert-warning">
                      ⚠️ OUTSIDE DELIVERY RADIUS - Please call customer to confirm delivery
                    </div>
                  ` : ''}
                  
                  ${order.deliveryOption === 'uber' ? `
                    <div style="background: #eff6ff; padding: 15px; border-radius: 8px; margin-top: 15px; border: 2px solid #3b82f6;">
                      <p style="margin: 0; font-weight: bold; color: #1e40af;">🚗 UBER DELIVERY</p>
                      <p style="margin: 5px 0 0 0; font-size: 14px; color: #1e3a8a;">
                        Customer will arrange their own Uber. Give order to driver with ID: <strong>${order.orderId}</strong>
                      </p>
                    </div>
                  ` : ''}
                ` : `
                  <p style="margin-top: 15px;">
                    <strong>🏪 Collection from Store</strong><br/>
                    <span style="color: #6b7280;">Customer will pick up from restaurant</span>
                  </p>
                `}
              </div>

              <div class="section">
                <h2>🍴 Order Items</h2>
                ${order.items.map(item => `
                  <div class="item">
                    <div>
                      <div class="item-name">${item.name}</div>
                      <div class="item-quantity">Quantity: ${item.quantity}</div>
                    </div>
                    <div class="item-price">£${(item.price * item.quantity).toFixed(2)}</div>
                  </div>
                `).join('')}
                
                <div class="total-section">
                  <div class="total-row">
                    <span>Subtotal:</span>
                    <span><strong>£${order.subtotal}</strong></span>
                  </div>
                  <div class="total-row">
                    <span>Delivery Fee:</span>
                    <span><strong>£${order.deliveryFee}</strong></span>
                  </div>
                  <div class="total-final">
                    <span>TOTAL:</span>
                    <span>£${order.total}</span>
                  </div>
                </div>
              </div>

              <div class="section">
                <h2>💳 Payment Details</h2>
                <p><strong>Method:</strong> ${order.paymentMethod?.toUpperCase() || 'N/A'}</p>
                <p><strong>Status:</strong> <span style="color: #059669; font-weight: bold;">✅ ${order.paymentStatus?.toUpperCase()}</span></p>
                <p><strong>Transaction ID:</strong> <code style="background: #f3f4f6; padding: 5px 10px; border-radius: 4px; font-size: 12px;">${order.paymentId || 'N/A'}</code></p>
              </div>

              <div style="background: #fef3c7; padding: 20px; border-radius: 8px; border: 2px solid #f59e0b; text-align: center; margin-top: 30px;">
                <p style="margin: 0; font-size: 18px; font-weight: bold; color: #92400e;">
                  ${order.deliveryOption === 'collection' ? '⏰ Ready for collection in 30-45 minutes' : 
                    order.deliveryOption === 'uber' ? '⏰ Prepare for Uber pickup' :
                    '⏰ Deliver in 45-60 minutes'}
                </p>
              </div>
            </div>

            <div class="footer">
              <p style="margin: 5px 0;">D818 Restaurant | Nottingham, UK</p>
              <p style="margin: 5px 0;">📞 0784662910 | 📧 info@d818.co.uk</p>
            </div>
          </div>
        </body>
        </html>
  `;
}

function customerEmailHtml(order) {
  return `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              line-height: 1.6; 
              color: #333;
              margin: 0;
              padding: 0;
              background-color: #f3f4f6;
            }
            .container { 
              max-width: 600px; 
              margin: 20px auto;
              background: white;
              border-radius: 8px;
              overflow: hidden;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .header { 
              background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
              color: white; 
              padding: 40px 20px; 
              text-align: center;
            }
            .header h1 {
              margin: 0 0 10px 0;
              font-size: 32px;
            }
            .header p {
              margin: 0;
              font-size: 16px;
              opacity: 0.9;
            }
            .content { 
              padding: 30px 20px;
            }
            .success-box { 
              background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
              padding: 25px;
              border-left: 5px solid #10b981;
              margin: 0 0 30px 0;
              border-radius: 8px;
            }
            .success-box h2 {
              margin: 0 0 10px 0;
              color: #065f46;
              font-size: 24px;
            }
            .success-box p {
              margin: 0;
              color: #047857;
            }
            .order-info {
              background: #f9fafb;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
              border: 1px solid #e5e7eb;
            }
            .order-info p {
              margin: 8px 0;
            }
            .section { 
              margin: 25px 0;
              padding: 20px;
              background: #f9fafb;
              border-radius: 8px;
            }
            .section h3 {
              margin: 0 0 15px 0;
              color: #1f2937;
              font-size: 18px;
              border-bottom: 2px solid #f97316;
              padding-bottom: 10px;
            }
            .item { 
              padding: 12px;
              border-bottom: 1px solid #e5e7eb;
              display: flex;
              justify-content: space-between;
              background: white;
              margin: 5px 0;
              border-radius: 5px;
            }
            .item:last-child {
              border-bottom: none;
            }
            .total { 
              background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
              padding: 20px;
              font-size: 20px;
              font-weight: bold;
              display: flex;
              justify-content: space-between;
              border-radius: 8px;
              margin-top: 15px;
              color: #92400e;
            }
            .info-box {
              background: #eff6ff;
              border: 2px solid #3b82f6;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
            }
            .info-box h3 {
              margin: 0 0 10px 0;
              color: #1e40af;
            }
            .info-box ol {
              margin: 10px 0;
              padding-left: 20px;
              color: #1e3a8a;
            }
            .info-box li {
              margin: 5px 0;
            }
            .contact-box {
              background: white;
              padding: 20px;
              text-align: center;
              border: 2px dashed #e5e7eb;
              border-radius: 8px;
              margin: 30px 0;
            }
            .contact-box p {
              margin: 5px 0;
              color: #6b7280;
            }
            .contact-box a {
              color: #f97316;
              text-decoration: none;
              font-weight: bold;
            }
            .footer {
              background: #1f2937;
              color: white;
              padding: 30px 20px;
              text-align: center;
            }
            .footer p {
              margin: 5px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>✅ Order Confirmed!</h1>
              <p>Thank you for choosing D818</p>
            </div>
            
            <div class="content">
              <div class="success-box">
                <h2>Thank you, ${order.user.name}! 🎉</h2>
                <p>Your order has been received and payment confirmed.</p>
              </div>

              <div class="order-info">
                <p><strong>📋 Order ID:</strong> <span style="color: #f97316; font-weight: bold;">${order.orderId}</span></p>
                <p><strong>🕐 Order Time:</strong> ${new Date(order.timestamp).toLocaleString('en-GB', { 
                  dateStyle: 'full', 
                  timeStyle: 'short' 
                })}</p>
                <p><strong>💳 Payment:</strong> <span style="color: #10b981; font-weight: bold;">CONFIRMED</span></p>
              </div>

              <div class="section">
                <h3>📦 Your Order</h3>
                ${order.items.map(item => `
                  <div class="item">
                    <span><strong>${item.name}</strong> x${item.quantity}</span>
                    <span style="color: #f97316; font-weight: bold;">£${(item.price * item.quantity).toFixed(2)}</span>
                  </div>
                `).join('')}
                <div class="total">
                  <span>Total Paid:</span>
                  <span>£${order.total}</span>
                </div>
              </div>

              ${order.deliveryOption === 'collection' ? `
                <div class="section">
                  <h3>🏪 Collection Details</h3>
                  <p style="font-size: 18px; color: #10b981; font-weight: bold; margin: 0 0 15px 0;">
                    ⏰ Ready in 30-45 minutes
                  </p>
                  <p><strong>Pickup Location:</strong></p>
                  <p style="padding: 15px; background: white; border-left: 4px solid #f97316; margin: 10px 0;">
                    D818 Restaurant<br/>
                    Nottingham, UK
                  </p>
                  <p style="margin-top: 15px; color: #6b7280;">
                    Please show your Order ID when collecting: <strong style="color: #f97316;">${order.orderId}</strong>
                  </p>
                </div>
              ` : order.deliveryOption === 'uber' ? `
                <div class="info-box">
                  <h3>🚗 Uber Delivery - Next Steps</h3>
                  <p style="margin: 10px 0; color: #1e3a8a;">Follow these steps to get your food delivered:</p>
                  <ol>
                    <li>Open your <strong>Uber</strong> or <strong>Uber Eats</strong> app</li>
                    <li>Request a ride/delivery to: <strong>D818 Restaurant, Nottingham</strong></li>
                    <li>Give the driver your Order ID: <strong style="background: #fef3c7; padding: 3px 8px; border-radius: 4px;">${order.orderId}</strong></li>
                    <li>We'll hand your prepared order to the driver</li>
                  </ol>
                  <p style="margin-top: 15px; font-weight: bold; color: #1e40af;">
                    💡 Your food will be ready when the driver arrives!
                  </p>
                </div>
              ` : `
                <div class="section">
                  <h3>🚚 Delivery Details</h3>
                  <p style="font-size: 18px; color: #10b981; font-weight: bold; margin: 0 0 15px 0;">
                    ⏰ Arriving in 45-60 minutes
                  </p>
                  <p><strong>Delivery Address:</strong></p>
                  <p style="padding: 15px; background: white; border-left: 4px solid #f97316; margin: 10px 0;">
                    ${order.deliveryDetails.address}<br/>
                    ${order.deliveryDetails.postcode}
                  </p>
                  ${order.deliveryDetails.notes ? `
                    <p style="margin-top: 15px;"><strong>Your Notes:</strong></p>
                    <p style="background: #fffbeb; padding: 10px; border-radius: 5px;">
                      ${order.deliveryDetails.notes}
                    </p>
                  ` : ''}
                </div>
              `}

              <div class="contact-box">
                <p style="font-size: 16px; font-weight: bold; color: #1f2937; margin-bottom: 10px;">
                  Need Help? We're Here!
                </p>
                <p>📞 Call us: <a href="tel:0784662910">0784662910</a></p>
                <p>📧 Email us: <a href="mailto:info@d818.co.uk">info@d818.co.uk</a></p>
                <p style="margin-top: 15px; color: #9ca3af; font-size: 14px;">
                  Quote Order ID: <strong>${order.orderId}</strong>
                </p>
              </div>
            </div>

            <div class="footer">
              <p style="font-size: 18px; font-weight: bold; margin-bottom: 10px;">D818 Restaurant</p>
              <p>Authentic Afro-Caribbean Cuisine</p>
              <p style="margin-top: 15px;">📍 Nottingham, United Kingdom</p>
              <p>📞 0784662910 | 📧 info@d818.co.uk</p>
              <p style="margin-top: 20px; font-size: 12px; opacity: 0.7;">
                © 2024 D818 Restaurant. All rights reserved.
              </p>
            </div>
          </div>
        </body>
        </html>
  `;
}

// ----------------------
// WhatsApp (unchanged)
// ----------------------

async function sendPaymentConfirmation(orderId, amount) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioPhone = process.env.TWILIO_WHATSAPP_NUMBER;
  const yourPhone = process.env.YOUR_PHONE_NUMBER;

  if (!accountSid || !authToken) return;

  const message = `✅ *PAYMENT CONFIRMED*\n\nOrder: ${orderId}\nAmount: £${amount.toFixed(2)}\n\n👨‍🍳 Start preparing!`;

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  await fetch(twilioUrl, {
    method: "POST",
    headers: {
      Authorization:
        "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      From: twilioPhone,
      To: yourPhone,
      Body: message,
    }),
  });
}
