import { db } from "@/db";
import { userUsage } from "@/db/schema";
import { eq } from "drizzle-orm";

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider: "resend" | "smtp" | "simulation";
}

export async function isEmailBounced(email: string): Promise<boolean> {
  try {
    const [usage] = await db
      .select({ bounced: userUsage.bounced })
      .from(userUsage)
      .where(eq(userUsage.email, email))
      .limit(1);
    return usage?.bounced ?? false;
  } catch {
    return false;
  }
}

/**
 * Generate HTML email for product availability notification
 */
export function generateAvailabilityEmail(data: {
  userName: string;
  productName: string;
  productUrl: string;
  pincode: string;
  city: string;
  state: string;
}): { subject: string; html: string; text: string } {
  const subject = `🎉 Great News! "${data.productName}" is now available at your location!`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Product Now Available!</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7fa;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f7fa; padding: 20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">
                🎉 Your Product Is Now Available!
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="font-size: 18px; color: #1e293b; margin: 0 0 20px;">
                Hello <strong>${data.userName}</strong>,
              </p>

              <p style="font-size: 16px; color: #475569; margin: 0 0 30px; line-height: 1.6;">
                Great news! The product you were tracking is now deliverable to your location.
              </p>

              <!-- Product Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 30px;">
                <tr>
                  <td style="padding: 24px;">
                    <p style="font-size: 14px; color: #64748b; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px;">
                      Product
                    </p>
                    <p style="font-size: 20px; color: #1e293b; margin: 0 0 20px; font-weight: 600;">
                      ${data.productName}
                    </p>

                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="50%">
                          <p style="font-size: 14px; color: #64748b; margin: 0 0 4px;">Location</p>
                          <p style="font-size: 16px; color: #1e293b; margin: 0; font-weight: 500;">
                            ${data.city}, ${data.state}
                          </p>
                        </td>
                        <td width="50%">
                          <p style="font-size: 14px; color: #64748b; margin: 0 0 4px;">Pincode</p>
                          <p style="font-size: 16px; color: #1e293b; margin: 0; font-weight: 500;">
                            ${data.pincode}
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${data.productUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; padding: 16px 32px; border-radius: 8px;">
                      View Product & Buy Now →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="font-size: 14px; color: #64748b; margin: 30px 0 0; line-height: 1.6;">
                Don't wait too long — product availability can change quickly!
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 30px; border-top: 1px solid #e2e8f0;">
              <p style="font-size: 14px; color: #64748b; margin: 0; text-align: center;">
                You received this email because you subscribed to availability alerts on<br>
                <strong>Product Availability Tracker</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `
Hello ${data.userName},

Great news! The product you were tracking is now deliverable to your location.

Product: ${data.productName}
Location: ${data.city}, ${data.state}
Pincode: ${data.pincode}

View Product: ${data.productUrl}

Don't wait too long — product availability can change quickly!

---
Product Availability Tracker
`;

  return { subject, html, text };
}

/**
 * Send email using Resend API
 */
async function sendWithResend(payload: EmailPayload): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return { success: false, error: "RESEND_API_KEY not configured", provider: "resend" };
  }

  const emailFrom = process.env.EMAIL_FROM;
  if (!emailFrom) {
    return { success: false, error: "EMAIL_FROM not configured — must be set to a verified custom domain", provider: "resend" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: emailFrom,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      return { success: true, messageId: data.id, provider: "resend" };
    } else {
      return { success: false, error: data.message || "Unknown error", provider: "resend" };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      provider: "resend",
    };
  }
}

/**
 * Send email using configured provider
 */
export async function sendEmail(payload: EmailPayload): Promise<EmailResult> {
  if (!process.env.RESEND_API_KEY) {
    return { success: false, error: "RESEND_API_KEY not configured — cannot send emails", provider: "resend" };
  }

  if (!process.env.EMAIL_FROM) {
    return { success: false, error: "EMAIL_FROM not configured — must be set to a verified custom domain before sending", provider: "resend" };
  }

  return sendWithResend(payload);
}

/**
 * Send availability notification email with bounce check
 */
export async function sendAvailabilityNotification(data: {
  userName: string;
  email: string;
  productName: string;
  productUrl: string;
  pincode: string;
  city: string;
  state: string;
}): Promise<EmailResult> {
  const bounced = await isEmailBounced(data.email);
  if (bounced) {
    return { success: false, error: "Email is bounced — not sending notification", provider: "resend" };
  }

  const { subject, html, text } = generateAvailabilityEmail(data);

  return sendEmail({
    to: data.email,
    subject,
    html,
    text,
  });
}
