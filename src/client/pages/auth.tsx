import { useState } from "react"
import { useNavigate } from "react-router"
import { AuthLayout, ForgotPasswordForm, LoginForm, RegisterForm } from "@ziku/ui"

import { authClient } from "../lib/auth-client"

const Logo = <span className="text-lg font-semibold tracking-tight">ziku app</span>
const Footer = (
  <>
    By continuing you agree to our <a href="/terms">Terms</a> and{" "}
    <a href="/privacy">Privacy Policy</a>.
  </>
)

export function LoginPage() {
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  return (
    <AuthLayout logo={Logo} footer={Footer}>
      <LoginForm
        error={error}
        onSubmit={async ({ email, password }) => {
          setError(null)
          const { error } = await authClient.signIn.email({ email, password })
          if (error) return setError(error.message ?? "Could not sign in.")
          navigate("/")
        }}
      />
    </AuthLayout>
  )
}

export function RegisterPage() {
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  return (
    <AuthLayout logo={Logo} footer={Footer}>
      <RegisterForm
        error={error}
        onSubmit={async ({ name, email, password }) => {
          setError(null)
          const { error } = await authClient.signUp.email({ name, email, password })
          if (error) return setError(error.message ?? "Could not create the account.")
          navigate("/")
        }}
      />
    </AuthLayout>
  )
}

export function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  return (
    <AuthLayout logo={Logo}>
      <ForgotPasswordForm
        error={error}
        sent={sent}
        onSubmit={async ({ email }) => {
          setError(null)
          const { error } = await authClient.requestPasswordReset({
            email,
            redirectTo: "/reset-password",
          })
          // Same outcome either way: never confirm whether an account exists.
          if (error) setError(error.message ?? "Could not send the link.")
          else setSent(true)
        }}
      />
    </AuthLayout>
  )
}
