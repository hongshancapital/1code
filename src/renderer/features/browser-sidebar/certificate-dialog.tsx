/**
 * Certificate Dialog Component
 * Displays SSL certificate information similar to Chrome's certificate viewer
 */

import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Shield, ShieldAlert, Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"

/** Certificate info returned from IPC */
interface CertificateInfo {
  subject: {
    commonName: string
    organization?: string
    organizationalUnit?: string
  }
  issuer: {
    commonName: string
    organization?: string
    organizationalUnit?: string
  }
  validFrom: string
  validTo: string
  fingerprint: string
  serialNumber: string
}

interface CertificateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  url: string
  hostname: string
}

export function CertificateDialog({
  open,
  onOpenChange,
  url,
  hostname,
}: CertificateDialogProps) {
  const { t } = useTranslation("common")
  const [certificate, setCertificate] = useState<CertificateInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  useEffect(() => {
    if (open && url) {
      setLoading(true)
      setError(null)
      setCertificate(null)

      window.desktopApi
        .browserGetCertificate(url)
        .then((cert) => {
          setCertificate(cert)
          if (!cert) {
            setError(t("browser.certificate.noCertificate"))
          }
        })
        .catch(() => {
          setError(t("browser.certificate.fetchError"))
        })
        .finally(() => {
          setLoading(false)
        })
    }
  }, [open, url, t])

  const copyToClipboard = async (text: string, field: string) => {
    await window.desktopApi.clipboardWrite(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr)
      return date.toLocaleString()
    } catch {
      return dateStr
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {certificate ? (
              <Shield className="w-5 h-5 text-green-500" />
            ) : (
              <ShieldAlert className="w-5 h-5 text-yellow-500" />
            )}
            {t("browser.certificate.title", { hostname })}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground">
            {t("browser.certificate.loading")}
          </div>
        ) : error ? (
          <div className="py-8 text-center text-muted-foreground">{error}</div>
        ) : certificate ? (
          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="basic" className="flex-1">
                {t("browser.certificate.basicInfo")}
              </TabsTrigger>
              <TabsTrigger value="details" className="flex-1">
                {t("browser.certificate.details")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4 mt-4">
              {/* Subject */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">
                  {t("browser.certificate.subject")}
                </h4>
                <div className="space-y-1 text-sm">
                  <CertRow
                    label={t("browser.certificate.commonName")}
                    value={certificate.subject.commonName}
                  />
                  {certificate.subject.organization && (
                    <CertRow
                      label={t("browser.certificate.organization")}
                      value={certificate.subject.organization}
                    />
                  )}
                  {certificate.subject.organizationalUnit && (
                    <CertRow
                      label={t("browser.certificate.organizationalUnit")}
                      value={certificate.subject.organizationalUnit}
                    />
                  )}
                </div>
              </div>

              {/* Issuer */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">
                  {t("browser.certificate.issuer")}
                </h4>
                <div className="space-y-1 text-sm">
                  <CertRow
                    label={t("browser.certificate.commonName")}
                    value={certificate.issuer.commonName}
                  />
                  {certificate.issuer.organization && (
                    <CertRow
                      label={t("browser.certificate.organization")}
                      value={certificate.issuer.organization}
                    />
                  )}
                  {certificate.issuer.organizationalUnit && (
                    <CertRow
                      label={t("browser.certificate.organizationalUnit")}
                      value={certificate.issuer.organizationalUnit}
                    />
                  )}
                </div>
              </div>

              {/* Validity */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">
                  {t("browser.certificate.validity")}
                </h4>
                <div className="space-y-1 text-sm">
                  <CertRow
                    label={t("browser.certificate.validFrom")}
                    value={formatDate(certificate.validFrom)}
                  />
                  <CertRow
                    label={t("browser.certificate.validTo")}
                    value={formatDate(certificate.validTo)}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="details" className="space-y-4 mt-4">
              {/* Serial Number */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">
                  {t("browser.certificate.serialNumber")}
                </h4>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-muted px-2 py-1 rounded break-all">
                    {certificate.serialNumber}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() =>
                      copyToClipboard(certificate.serialNumber, "serial")
                    }
                  >
                    {copiedField === "serial" ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Fingerprint */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">
                  {t("browser.certificate.fingerprint")}
                </h4>
                <div className="flex items-start gap-2">
                  <code className="flex-1 text-xs bg-muted px-2 py-1 rounded break-all font-mono">
                    {certificate.fingerprint}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() =>
                      copyToClipboard(certificate.fingerprint, "fingerprint")
                    }
                  >
                    {copiedField === "fingerprint" ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function CertRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground shrink-0 w-20">{label}</span>
      <span className="truncate">{value || "-"}</span>
    </div>
  )
}
