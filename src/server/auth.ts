import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"

import { db } from "./db"

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.APP_URL ?? "http://localhost:5173",
  basePath: "/api/auth",
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // ponytail: logs the link instead of sending mail. Swap in Resend/SMTP
    // when a client actually needs password resets by email.
    sendResetPassword: async ({ user, url }) => {
      console.log(`[auth] password reset for ${user.email}: ${url}`)
    },
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "member", input: false },
    },
  },
})

export type Session = typeof auth.$Infer.Session
