import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/**
 * The `sep24Sessions` collection (README §12.2).
 *
 * Holds the anchor's SEP-10 JWT server-side. The frontend never sees it — it gets an
 * opaque session reference instead, and the backend makes anchor calls on its behalf
 * (§10.4, §15.7). That keeps a bearer credential out of browser-accessible storage,
 * which is the habit worth keeping if Giffy ever points at a production anchor.
 */

/**
 * How long a session — and the anchor JWT inside it — is retained.
 *
 * The TTL index below is what makes §15.7 true over time rather than just at write
 * time: without it, every JWT Giffy has ever obtained would sit in the database
 * forever, long after the anchor stopped honouring it, as a credential worth stealing
 * for no operational benefit. Comfortably outlives a deposit, which completes in
 * minutes on the reference anchor.
 */
const SESSION_TTL_SECONDS = 24 * 60 * 60;

const sep24SessionSchema = new Schema(
  {
    /** Null for a general "buy funds" session not tied to a specific gift. */
    giftId: { type: Schema.Types.ObjectId, ref: 'Gift', default: null },
    senderPublicKey: { type: String, required: true },
    /**
     * Server-side only. `select: false` keeps it out of every query result unless a
     * caller asks for it by name, so it cannot reach a response body by accident —
     * the same reason the raw JWT never becomes part of any DTO.
     */
    anchorJwt: { type: String, required: true, select: false },
    /**
     * SHA-256 of the opaque session token handed to the frontend.
     *
     * Not in §12.2's field list, but required by §10.4's indirection: the frontend
     * must present *something* to resume a session, and it must not be the JWT. Hashed
     * for the same reason claim tokens are (§15.2) — a bearer value that grants
     * anchor-authenticated actions should not sit in the database in plaintext.
     */
    sessionTokenHash: { type: String, required: true, unique: true, select: false },
    anchorTransactionId: { type: String, default: null },
    interactiveUrl: { type: String, default: null },
    /** Mirrors the anchor's own enum verbatim — never re-mapped (§14.3). */
    status: { type: String, required: true, default: 'incomplete' },
    /** Set once a deposit is initiated; unknown at SEP-10 authentication time. */
    assetCode: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

sep24SessionSchema.index({ anchorTransactionId: 1 });
sep24SessionSchema.index({ senderPublicKey: 1, createdAt: -1 });

// Mongo reaps the document — JWT included — once `expiresAt` passes.
sep24SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export function sessionExpiryFromNow(): Date {
  return new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
}

export type Sep24Session = InferSchemaType<typeof sep24SessionSchema> & {
  createdAt: Date;
  updatedAt: Date;
};

export type Sep24SessionDocument = HydratedDocument<Sep24Session>;

export const Sep24SessionModel = model('Sep24Session', sep24SessionSchema);
