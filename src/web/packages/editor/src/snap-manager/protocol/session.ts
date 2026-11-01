/** A single-use plan id. */
export type PlanToken = Readonly<{
  sessionId: number;
  step: number;
}>;

/** A fresh pointer step that may be applied exactly once. */
export type PlannedRuntimeStep<Plan> = Readonly<{
  kind: "planned";
  token: PlanToken;
  plan: Plan;
}>;

/** A repeat of an already computed native pointer step. */
export type DuplicateRuntimeStep<Plan, Verification> = Readonly<{
  kind: "duplicate";
  phase: "pending" | "verified";
  token: PlanToken;
  plan: Plan;
  verification: Verification | null;
}>;

/** A fresh or repeated runtime result. */
export type RuntimeStep<Plan, Verification> =
  | PlannedRuntimeStep<Plan>
  | DuplicateRuntimeStep<Plan, Verification>;

/** State of one native pointer marker. */
export type PlanStepRecord<Intent, Plan, Verification> = {
  intent: Intent;
  token: PlanToken;
  plan: Plan;
  verification: Verification | null;
};

/** Mutable state of one active gesture. */
type ActiveSession<Baseline, HoldState, Intent, Plan, Verification> = {
  id: number;
  baseline: Baseline;
  holdState: HoldState;
  markerRecords: WeakMap<object, PlanStepRecord<Intent, Plan, Verification>>;
  pendingStep: PlanStepRecord<Intent, Plan, Verification> | null;
  nextStep: number;
};

/** The axis-specific behaviour the shared session protocol calls. */
export type SessionProtocolConfig<
  Baseline,
  HoldState,
  Intent,
  Plan,
  Verification extends { holdState: HoldState },
  FinalGeometry,
  StepProjection,
> = Readonly<{
  /** "Movement" or "Scale"; the protocol builds its lifecycle messages from it. */
  label: string;
  freeHoldState: HoldState;
  nextSessionId: () => number;
  snapshotIntent: (intent: Intent) => Intent;
  assertSameIntent: (args: {
    record: PlanStepRecord<Intent, Plan, Verification>;
    intent: Intent;
  }) => void;
  resolvePlan: (args: {
    baseline: Baseline;
    intent: Intent;
    holdState: HoldState;
    stepProjection?: StepProjection;
  }) => Plan;
  verifyPlan: (args: {
    baseline: Baseline;
    plan: Plan;
    finalGeometry: FinalGeometry;
  }) => Verification;
}>;

/** The idempotent result of ending a session. */
export type SessionCleanup<Verification> = Readonly<{
  didCleanup: boolean;
  verification: Verification | null;
}>;

/**
 * Owns the acquire-hold-plan-verify lifecycle once: session start, one plan per
 * native pointer marker, single-use tokens, the pending step, verification and
 * the transient hold. The family supplies only its plan and verification.
 */
export class SnappingSessionProtocol<
  Baseline,
  HoldState,
  Intent,
  Plan,
  Verification extends { holdState: HoldState },
  FinalGeometry,
  StepProjection = never,
> {
  private _session: ActiveSession<
    Baseline,
    HoldState,
    Intent,
    Plan,
    Verification
  > | null = null;

  private _lastVerification: Verification | null = null;

  private readonly _issuedTokens = new WeakSet<PlanToken>();

  private readonly _consumedTokens = new WeakSet<PlanToken>();

  private readonly _config: SessionProtocolConfig<
    Baseline,
    HoldState,
    Intent,
    Plan,
    Verification,
    FinalGeometry,
    StepProjection
  >;

  constructor(
    config: SessionProtocolConfig<
      Baseline,
      HoldState,
      Intent,
      Plan,
      Verification,
      FinalGeometry,
      StepProjection
    >,
  ) {
    this._config = config;
  }

  /** Starts a new session with an immutable baseline. */
  startSession({ baseline }: { baseline: Baseline }): void {
    if (this._session) {
      throw new Error(
        `${this._config.label} snapping runtime already has an active session`,
      );
    }

    this._session = {
      id: this._config.nextSessionId(),
      baseline,
      holdState: this._config.freeHoldState,
      markerRecords: new WeakMap<
        object,
        PlanStepRecord<Intent, Plan, Verification>
      >(),
      pendingStep: null,
      nextStep: 1,
    };
    this._lastVerification = null;
  }

  /** Returns the cached result instead of re-reading a mutated target. */
  getDuplicateStep({
    marker,
  }: {
    marker: object;
  }): DuplicateRuntimeStep<Plan, Verification> | null {
    const session = this._getActiveSession();
    const record = session.markerRecords.get(marker);
    if (!record) return null;

    return createDuplicateRuntimeStep({ record });
  }

  //** Issues at most one plan per native pointer marker. */
  resolveStep({
    marker,
    intent,
    stepProjection,
  }: {
    marker: object;
    intent: Intent;
    stepProjection?: StepProjection;
  }): RuntimeStep<Plan, Verification> {
    const session = this._getActiveSession();
    const duplicate = session.markerRecords.get(marker);
    if (duplicate) {
      this._config.assertSameIntent({ record: duplicate, intent });
      return createDuplicateRuntimeStep({ record: duplicate });
    }
    if (session.pendingStep) {
      throw new Error(
        `Previous ${this._lowerLabel()} plan token must be verified before the next pointer marker`,
      );
    }

    const plan = this._config.resolvePlan({
      baseline: session.baseline,
      intent,
      holdState: session.holdState,
      ...(stepProjection === undefined ? {} : { stepProjection }),
    });
    const token = this._createPlanToken({ session });
    const record: PlanStepRecord<Intent, Plan, Verification> = {
      intent: this._config.snapshotIntent(intent),
      token,
      plan,
      verification: null,
    };
    session.markerRecords.set(marker, record);
    session.pendingStep = record;

    return Object.freeze({ kind: "planned", token, plan });
  }

  /** Replaces the pending plan before it is applied. */
  refineStep({
    token,
    refine,
  }: {
    token: PlanToken;
    refine: (plan: Plan) => Plan;
  }): Plan {
    const session = this._getActiveSession();
    this._assertUsableToken({ session, token });

    const { pendingStep } = session;
    if (!pendingStep) {
      throw new Error(
        `${this._config.label} snapping runtime has no pointer step to refine`,
      );
    }

    const refinedPlan = refine(pendingStep.plan);
    pendingStep.plan = refinedPlan;

    return refinedPlan;
  }

  /** Verifies the applied plan and then updates the transient hold state. */
  verifyStep({
    token,
    finalGeometry,
  }: {
    token: PlanToken;
    finalGeometry: FinalGeometry;
  }): Verification {
    const session = this._getActiveSession();
    this._assertUsableToken({ session, token });

    const { pendingStep } = session;
    if (!pendingStep) {
      throw new Error(
        `${this._config.label} snapping runtime has no pointer step to verify`,
      );
    }

    const verification = this._config.verifyPlan({
      baseline: session.baseline,
      plan: pendingStep.plan,
      finalGeometry,
    });
    this._consumedTokens.add(token);
    pendingStep.verification = verification;
    session.pendingStep = null;
    session.holdState = verification.holdState;
    this._lastVerification = verification;

    return verification;
  }

  /** Ends the active session exactly once and returns its last verification. */
  finishSession(): SessionCleanup<Verification> {
    const session = this._session;
    if (!session) {
      return Object.freeze({ didCleanup: false, verification: null });
    }

    const pendingToken = session.pendingStep?.token;
    if (pendingToken) this._consumedTokens.add(pendingToken);

    const verification = this._lastVerification;
    this._session = null;
    this._lastVerification = null;

    return Object.freeze({ didCleanup: true, verification });
  }

  /** Returns the active session or fails loudly on a lifecycle violation. */
  private _getActiveSession(): ActiveSession<
    Baseline,
    HoldState,
    Intent,
    Plan,
    Verification
  > {
    if (!this._session) {
      throw new Error(
        `${this._config.label} snapping runtime has no active session`,
      );
    }

    return this._session;
  }

  //** Creates a single-use token for the current pointer step. */
  private _createPlanToken({
    session,
  }: {
    session: ActiveSession<Baseline, HoldState, Intent, Plan, Verification>;
  }): PlanToken {
    const token = Object.freeze({
      sessionId: session.id,
      step: session.nextStep,
    });
    session.nextStep += 1;
    this._issuedTokens.add(token);

    return token;
  }

  /** Rejects foreign, stale or already-spent tokens. */
  private _assertUsableToken({
    session,
    token,
  }: {
    session: ActiveSession<Baseline, HoldState, Intent, Plan, Verification>;
    token: PlanToken;
  }): void {
    const label = this._config.label;
    if (!this._issuedTokens.has(token)) {
      throw new Error(`Foreign ${this._lowerLabel()} plan token`);
    }
    if (this._consumedTokens.has(token)) {
      throw new Error(`${label} plan token has already been used`);
    }
    if (!session.pendingStep || session.pendingStep.token !== token) {
      throw new Error(
        `${label} plan token does not belong to the current pointer step`,
      );
    }
  }

  private _lowerLabel(): string {
    return this._config.label.toLowerCase();
  }
}

/** Returns the immutable duplicate step from the stored record. */
function createDuplicateRuntimeStep<Intent, Plan, Verification>({
  record,
}: {
  record: PlanStepRecord<Intent, Plan, Verification>;
}): DuplicateRuntimeStep<Plan, Verification> {
  return Object.freeze({
    kind: "duplicate",
    phase: record.verification ? "verified" : "pending",
    token: record.token,
    plan: record.plan,
    verification: record.verification,
  });
}
