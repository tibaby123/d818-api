import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  // CORS (you already also do this globally via vercel.json, but harmless here)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { orderId, items, deliveryFee, user, deliveryDetails, deliveryOption, withinRadius} = req.body;

    if (!orderId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Missing orderId or items" });
    }

    // Build line items from cart
    const line_items = items.map((it) => {
      const name = String(it.name || "Item");
      const qty = Number(it.quantity || 0);
      const price = Number(it.price || 0);

      if (!Number.isFinite(qty) || qty <= 0) throw new Error("Invalid item quantity");
      if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid item price");

      return {
        quantity: qty,
        price_data: {
          currency: "gbp",
          unit_amount: Math.round(price * 100), // pence
          product_data: { name },
        },
      };
    });

    const fee = Number(deliveryFee || 0);
    if (Number.isFinite(fee) && fee > 0) {
      line_items.push({
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: Math.round(fee * 100),
          product_data: { name: "Delivery fee" },
        },
      });
    }

    const FRONTEND_URL = process.env.FRONTEND_URL; // e.g. https://d818-restaurant.vercel.app
    if (!FRONTEND_URL) {
      return res.status(500).json({ error: "Missing FRONTEND_URL env var" });
    }

    // Keep metadata small (Stripe has limits). Line items already hold the cart.
    // const metadata = {
    //   orderId: String(orderId),
    //   customerEmail: String(user?.email || ""),
    //   customerName: String(user?.name || ""),
    //   phone: String(deliveryDetails?.phone || user?.phone || ""),
    //   deliveryOption: String(deliveryOption || ""),
    //   postcode: String(deliveryDetails?.postcode || ""),
    //   address: String(deliveryDetails?.address || ""),
    //   notes: String(deliveryDetails?.notes || ""),
    // };


    const deliveryOptionSafe = ["collection", "delivery", "uber"].includes(deliveryOption)
      ? deliveryOption: "collection";


      const metadata = {
        orderId: String(orderId),
        customerEmail: String(user?.email || ""),
        customerName: String(user?.name || ""),
        phone: String(deliveryDetails?.phone || user?.phone || ""),
        deliveryOption: String(deliveryOptionSafe),
        postcode: String(deliveryDetails?.postcode || ""),
        address: String(deliveryDetails?.address || ""),
        notes: String(deliveryDetails?.notes || ""),
        withinRadius: String(withinRadius ?? true),

    };


    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      client_reference_id: orderId, // your webhook already reads this
      line_items,
      // success_url: `${FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      // cancel_url: `${FRONTEND_URL}/?payment=cancelled`,
      success_url: `${FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}&orderId=${encodeURIComponent(orderId)}`,
      cancel_url: `${FRONTEND_URL}/?payment=cancelled&orderId=${encodeURIComponent(orderId)}`,
      customer_email: user?.email || undefined,
      payment_intent_data: {description: `D818 Order ${orderId}`,},
      metadata,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Failed to create checkout session" });
  }
}
