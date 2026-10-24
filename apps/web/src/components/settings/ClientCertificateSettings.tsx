import type { DesktopClientCertificatePreference } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useState } from "react";

import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function ClientCertificateSettings() {
  const bridge = window.desktopBridge;
  const [certificates, setCertificates] = useState<readonly DesktopClientCertificatePreference[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forgetOrigin, setForgetOrigin] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const load = () =>
    bridge?.getClientCertificates?.().then(
      (result) => {
        setCertificates(result);
        setError(null);
        setLoading(false);
      },
      (cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Couldn't load client certificates.");
        setLoading(false);
      },
    );

  const loadOnMount = useEffectEvent(() => void load());
  // oxlint-disable-next-line t3code/react-effect-budget -- Read certificate preferences from Electron when Settings mounts.
  useEffect(() => {
    loadOnMount();
  }, []);

  if (!bridge?.getClientCertificates || !bridge.forgetClientCertificate) return null;

  const forget = async () => {
    if (!forgetOrigin) return;
    setForgetting(true);
    try {
      await bridge.forgetClientCertificate?.(forgetOrigin);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't forget the client certificate.");
      setForgetting(false);
      setForgetOrigin(null);
    }
  };

  return (
    <SettingsSection
      {...searchableSetting("client-certificates")}
      headerAction={
        <Button
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          {loading ? "Loading…" : "Refresh"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        When a server requests a client certificate, choose one installed on this computer.
        Remembered choices apply only to this T3 Code installation and the exact server address and
        port.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!loading && certificates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No remembered certificates. Use Choose client certificate when adding an environment to
          select one before pairing.
        </p>
      ) : null}
      {certificates.map((certificate) => (
        <SettingsRow
          key={certificate.origin}
          title={certificate.origin}
          description={
            <span className="grid gap-1">
              <span>
                {certificate.subjectName} · {certificate.issuerName}
              </span>
              <span>Expires {new Date(certificate.validExpiry * 1000).toLocaleDateString()}</span>
              <span className="break-all font-mono text-xs">
                SHA-256: {certificate.fingerprint}
              </span>
            </span>
          }
          control={
            <Button size="sm" variant="outline" onClick={() => setForgetOrigin(certificate.origin)}>
              Forget…
            </Button>
          }
        />
      ))}
      <AlertDialog
        open={forgetOrigin !== null}
        onOpenChange={(open) => {
          if (!open && !forgetting) setForgetOrigin(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Forget this certificate and restart?</AlertDialogTitle>
            <AlertDialogDescription>
              T3 Code will restart to clear existing certificate sessions for {forgetOrigin}. You'll
              choose a certificate the next time this server requests one. The installed certificate
              stays on your computer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" disabled={forgetting} />}>
              Cancel
            </AlertDialogClose>
            <Button disabled={forgetting} onClick={() => void forget()}>
              {forgetting ? "Restarting…" : "Forget and restart"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsSection>
  );
}
