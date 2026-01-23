import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const sessionId = req.query.session_id;
  if (!sessionId) return res.status(400).json({ error: "Missing session_id" });

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return res.status(200).json({
      paid: session.payment_status === "paid",
      amount_total: (session.amount_total || 0) / 100,
      orderId: session.client_reference_id || session.metadata?.orderId || null,
    });
  } catch (e) {
    return res.status(500).json({ error: "Failed to verify session" });
  }
}
