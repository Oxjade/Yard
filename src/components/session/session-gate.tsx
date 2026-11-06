"use client"

import { useState } from "react"
import { LockKeyIcon, SignInIcon, UserSwitchIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { EmptyState } from "@/components/dashboard/empty-state"
import { Bone } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api/client"
import type { DemoSignInResult } from "@/lib/api/contracts/session"
import { errorMessage } from "@/lib/api/errors"
import { useAsyncAction } from "@/hooks/use-async-action"
import { adminRoleLabels, canAdmin, canBrand, isBrandPermission, needsRole, roleCantSentence, type AdminPermission, type BrandPermission } from "@/lib/permissions"
import { afterIdentityChange } from "@/lib/session/identity"
import { refreshServerSession, useServerSession } from "@/lib/session/use-server-session"
import { useSession } from "@/lib/stores/session"
import { DemoAccountPicker } from "./demo-account-picker"

type Props = {
  surface: "studio" | "admin" | "market"
  /** What the page is for, in the sentence "Sign in to Brand Studio to use {feature}". */
  feature: string
  permission?: BrandPermission | AdminPermission
  children: React.ReactNode
}

/** The default demo account each surface offers first (§2.3). */
const defaults = {
  studio: { actor: "brand", account: "u_b_tobi", label: "Continue as Tobi Adeyemi (demo owner)" },
  admin: { actor: "admin", account: "adm_1", label: "Continue as Kemi Ajayi (demo owner)" },
} as const

/** Full width on phones and free to wrap, so a long account name never forces a sideways scroll. */
const wrapButton = "h-auto min-h-10 w-full whitespace-normal py-2 text-center sm:w-auto"

/**
 * Gates a server-backed page on the surface's session (§2.3): a skeleton while the session
 * loads, a sign-in invitation when signed out (demo accounts; no passwords in this build), the
 * role reason when the permission is missing, and the page otherwise. Server endpoints check
 * everything again; this only decides what to render.
 */
export function SessionGate({ surface, feature, permission, children }: Props) {
  const s = useServerSession()
  const [picker, setPicker] = useState(false)
  const requireAuth = useSession((x) => x.requireAuth)
  const continueAs = useAsyncAction(
    async () => {
      if (surface === "market") return
      const d = defaults[surface]
      await api<DemoSignInResult>("/api/auth/demo", { body: { actor: d.actor, account: d.account } })
      await afterIdentityChange(surface)
    },
    { error: "Couldn't sign in to the demo account. Try again." },
  )

  if (s.status === "loading") {
    return (
      <div aria-busy className="grid gap-3" role="status">
        <span className="sr-only">Checking your session</span>
        <Bone className="h-8 w-48" />
        <Bone className="h-40 w-full rounded-lg" />
      </div>
    )
  }

  if (s.status === "error") {
    return (
      <EmptyState
        icon={LockKeyIcon}
        title="Couldn't check your session"
        body="Yard's server didn't answer. Check your connection, then try again."
        action={
          <Button variant="secondary" onClick={() => void refreshServerSession().catch((e) => toast.error(errorMessage(e)))}>
            Try again
          </Button>
        }
      />
    )
  }

  if (surface === "market") {
    if (!s.shopper)
      return (
        <EmptyState
          icon={SignInIcon}
          title={`Sign in to use ${feature}`}
          body="Demo build: you'll be signed in as the demo shopper Ada Nwosu."
          action={
            <Button variant="primary" onClick={() => requireAuth("account")}>
              Sign in
            </Button>
          }
        />
      )
    return <>{children}</>
  }

  const actor = surface === "studio" ? s.brand : s.admin
  const demoOn = surface === "studio" ? !!s.demoAuth?.brand : !!s.demoAuth?.admin
  const where = surface === "studio" ? "Brand Studio" : "the Control Center"

  if (!actor) {
    return (
      <>
        <EmptyState
          icon={SignInIcon}
          title={`Sign in to ${where} to use ${feature}`}
          body={demoOn ? "Demo build: there are no real accounts yet. Choose a demo account to continue." : "Demo sign-in is off on this server, and this build has no other way to sign in."}
          action={
            demoOn ? (
              <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center">
                <Button variant="primary" className={wrapButton} loading={continueAs.pending} success={continueAs.succeeded} onClick={() => void continueAs.run()}>
                  {defaults[surface].label}
                </Button>
                <Button variant="secondary" className={wrapButton} onClick={() => setPicker(true)}>
                  <UserSwitchIcon aria-hidden /> Choose another demo account
                </Button>
              </div>
            ) : undefined
          }
        />
        {demoOn ? <DemoAccountPicker surface={surface} open={picker} onOpenChange={setPicker} /> : null}
      </>
    )
  }

  // A demo build has no owner to ask: offer a demo account that holds the permission instead.
  const switchAction = demoOn ? (
    <Button variant="secondary" className={wrapButton} onClick={() => setPicker(true)}>
      <UserSwitchIcon aria-hidden /> Switch demo account
    </Button>
  ) : undefined
  const missing = (title: string, body: string) => (
    <>
      <EmptyState icon={LockKeyIcon} title={title} body={demoOn ? `${body} ${surface === "studio" ? "In this demo build, switch to an owner's demo account." : "In this demo build, switch to a demo admin with that role."}` : body} action={switchAction} />
      {demoOn ? <DemoAccountPicker surface={surface} open={picker} onOpenChange={setPicker} /> : null}
    </>
  )

  if (permission) {
    if (surface === "studio" && s.brand && isBrandPermission(permission) && !canBrand(s.brand.role, permission)) {
      return missing(`You can't use ${feature} with this role`, roleCantSentence(s.brand.role, permission))
    }
    if (surface === "admin" && s.admin && !isBrandPermission(permission) && !canAdmin(s.admin.role, permission as AdminPermission)) {
      return missing("Your role can't open this page", `You're signed in as ${adminRoleLabels[s.admin.role]}. ${needsRole(permission)}.`)
    }
  }
  return <>{children}</>
}
