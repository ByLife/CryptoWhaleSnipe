// src/database/models/Regime.ts
// One document per UTC day: is the copy bot allowed to trade? (see autoload/regime.ts)

import mongoose, { Document, Schema } from "mongoose";

export interface RegimeDay {
  day: Date; // 00:00 UTC
  share: number; // share of the alt basket above its 50d average (yesterday's close)
  altsUp: boolean; // share > 0.5
  streak: number; // consecutive altsUp days up to this day
  on: boolean; // streak >= REGIME_STREAK_DAYS
  nCoins: number;
}

const RegimeSchema = new Schema(
  {
    day: { type: Date, required: true, unique: true },
    share: Number,
    altsUp: Boolean,
    streak: Number,
    on: Boolean,
    nCoins: Number,
  },
  { timestamps: true }
);

export default mongoose.model<RegimeDay & Document>("Regime", RegimeSchema);
