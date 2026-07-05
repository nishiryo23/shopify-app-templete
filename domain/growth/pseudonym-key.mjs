import { fingerprintTelemetryPseudonymKey } from "../telemetry/emf.mjs";

export const TELEMETRY_PSEUDONYM_KEY_FINGERPRINT_ID = "telemetry-pseudonym-key";

export class TelemetryPseudonymKeyRotationError extends Error {
  constructor(message) {
    super(message);
    this.name = "TelemetryPseudonymKeyRotationError";
  }
}

export class TelemetryPseudonymKeyConsistencyError extends Error {
  constructor(message) {
    super(message);
    this.name = "TelemetryPseudonymKeyConsistencyError";
  }
}

function isPrismaUniqueError(error) {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "P2002"
  );
}

function buildRotationError({ expectedFingerprint, receivedFingerprint }) {
  return new TelemetryPseudonymKeyRotationError(
    [
      "TELEMETRY_PSEUDONYM_KEY fingerprint mismatch; implicit key rotation is blocked.",
      "FunnelEvent shopHash values must remain deletable by shop/redact.",
      `storedFingerprint=${expectedFingerprint}`,
      `currentFingerprint=${receivedFingerprint}`,
      "Restore the previous TELEMETRY_PSEUDONYM_KEY, or run a documented one-off migration that deletes or rewrites FunnelEvent rows before updating the stored fingerprint.",
    ].join(" "),
  );
}

function buildMissingFingerprintError() {
  return new TelemetryPseudonymKeyConsistencyError(
    [
      "TELEMETRY_PSEUDONYM_KEY fingerprint row is missing while FunnelEvent rows exist.",
      "Refusing to initialize the current key as canonical because shop/redact could miss rows hashed with the previous key.",
      "Restore the previous TELEMETRY_PSEUDONYM_KEY and fingerprint row from backup, or run a documented one-off maintenance migration that hard-deletes or rewrites all FunnelEvent.shopHash rows before inserting the new fingerprint.",
    ].join(" "),
  );
}

function assertFingerprintMatches({ currentFingerprint, storedFingerprint }) {
  if (storedFingerprint !== currentFingerprint) {
    throw buildRotationError({
      expectedFingerprint: storedFingerprint,
      receivedFingerprint: currentFingerprint,
    });
  }
}

export function resolveTelemetryPseudonymKeyFingerprint({ env = process.env } = {}) {
  return fingerprintTelemetryPseudonymKey(env);
}

async function assertNoExistingFunnelEvents({ prismaClient }) {
  const existingFunnelEvent = await prismaClient.funnelEvent.findFirst({
    select: { id: true },
  });

  if (existingFunnelEvent) {
    throw buildMissingFingerprintError();
  }
}

export async function assertTelemetryPseudonymKeyFingerprint({
  env = process.env,
  prismaClient,
}) {
  const currentFingerprint = resolveTelemetryPseudonymKeyFingerprint({ env });
  const store = prismaClient.telemetryPseudonymKeyFingerprint;
  const existing = await store.findUnique({
    select: { fingerprintSha256: true },
    where: { id: TELEMETRY_PSEUDONYM_KEY_FINGERPRINT_ID },
  });

  if (existing) {
    assertFingerprintMatches({
      currentFingerprint,
      storedFingerprint: existing.fingerprintSha256,
    });
    return currentFingerprint;
  }

  await assertNoExistingFunnelEvents({ prismaClient });

  try {
    await store.create({
      data: {
        fingerprintSha256: currentFingerprint,
        id: TELEMETRY_PSEUDONYM_KEY_FINGERPRINT_ID,
      },
    });
    return currentFingerprint;
  } catch (error) {
    if (!isPrismaUniqueError(error)) {
      throw error;
    }
  }

  const createdByPeer = await store.findUnique({
    select: { fingerprintSha256: true },
    where: { id: TELEMETRY_PSEUDONYM_KEY_FINGERPRINT_ID },
  });

  if (!createdByPeer) {
    throw new Error("TELEMETRY_PSEUDONYM_KEY fingerprint could not be verified after concurrent initialization.");
  }

  assertFingerprintMatches({
    currentFingerprint,
    storedFingerprint: createdByPeer.fingerprintSha256,
  });
  return currentFingerprint;
}
