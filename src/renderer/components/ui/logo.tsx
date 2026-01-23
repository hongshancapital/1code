import * as React from "react"

interface LogoProps extends React.SVGProps<SVGSVGElement> {
  className?: string
  fill?: string
}

// TODO: Replace with Hóng logo
export function Logo({ fill = "currentColor", className, ...props }: LogoProps) {
  return null
}
