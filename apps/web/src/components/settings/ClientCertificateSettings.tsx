import { useState } from "react";
import { useAtomRefresh } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import { useEnvironmentQuery } from "~/state/query";

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

class ClientCertificatesLoadError extends Schema.TaggedError<ClientCertificatesLoadError>()(
  "ClientCertificatesLoadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Couldn't load client certificates.";
  }
}

const clientCertificatesAtom = Atom.make(
  Effect.tryPromise({
    try: async () => (await window.desktopBridge?.getClientCertificates?.()) ?? [],
    catch: (cause) => new ClientCertificatesLoadError({ cause }),
  }),
).pipe(Atom.swr({ staleTime: 0, revalidateOnMount: true }));

export function ClientCertificateSettings() {
  const bridge = window.desktopBridge;
  const query = useEnvironmentQuery(bridge?.getClientCertificates ? clientCertificatesAtom : null);
  const refresh = useAtomRefresh(clientCertificatesAtom);
  const certificates = query.data ?? [];
  const loading = query.isPending;
  const [error, setError] = useState<string | null>(null);
  const [forgetOrigin, setForgetOrigin] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);

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
            setError(null);
            refresh();
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
      {error || query.error ? (
        <p role="alert" className="text-sm text-destructive">
          {error ?? query.error}
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
