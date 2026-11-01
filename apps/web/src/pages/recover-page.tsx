import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { recoverOwner } from "@/api";
import { AuthPageFrame } from "@/components/auth-page-frame";
import {
  MIN_PASSWORD_LENGTH,
  NewPasswordFields,
} from "@/components/new-password-fields";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";

export function RecoverPage() {
  const { t } = useI18n();
  const navigate = useNavigate({ from: "/recover" });
  const [recoverySecret, setRecoverySecret] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async () => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setFormError(t("auth.passwordLength"));
      return;
    }
    if (newPassword !== confirmation) {
      setFormError(t("auth.passwordMismatch"));
      return;
    }

    setFormError(null);
    setIsSubmitting(true);
    try {
      await recoverOwner({
        recoverySecret: recoverySecret.trim(),
        newPassword,
      });
      setDone(true);
    } catch (error) {
      setFormError(errorMessage(error, t("recover.failed")));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (done) {
    return (
      <AuthPageFrame title={t("recover.title")}>
        <Alert role="status" variant="success">
          {t("recover.success")}
        </Alert>
        <Button
          className="mt-4 w-full"
          variant="brand"
          onClick={() => void navigate({ replace: true, to: "/login" })}
        >
          {t("auth.signIn")}
        </Button>
      </AuthPageFrame>
    );
  }

  return (
    <AuthPageFrame
      description={t("recover.description")}
      title={t("recover.title")}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <label
          className="flex flex-col gap-1.5 text-sm font-medium"
          htmlFor="recover-secret"
        >
          {t("recover.secret")}
          <Input
            autoComplete="off"
            disabled={isSubmitting}
            id="recover-secret"
            required
            type="password"
            value={recoverySecret}
            onChange={(event) => setRecoverySecret(event.target.value)}
          />
        </label>
        <NewPasswordFields
          confirmation={confirmation}
          disabled={isSubmitting}
          idPrefix="recover"
          newPassword={newPassword}
          onConfirmationChange={setConfirmation}
          onNewPasswordChange={setNewPassword}
        />
        {formError && <Alert variant="destructive">{formError}</Alert>}
        <Button disabled={isSubmitting} type="submit" variant="brand">
          {isSubmitting ? t("recover.submitting") : t("recover.submit")}
        </Button>
      </form>
    </AuthPageFrame>
  );
}
