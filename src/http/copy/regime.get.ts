// src/http/copy/regime.get.ts

import express from "express";
import AccessBearer from "../../database/models/AccessBearer";
import Regime from "../../database/models/Regime";
import { regimeConfig } from "../../autoload/regime";

export default {
  name: "/copy/regime",
  description: "Copy bot market regime: today + last 60 days",
  method: "GET",
  run: async (req: express.Request, res: express.Response) => {
    try {
      if (!req.token) throw "Unauthorized access, missing 'token' in request header";
      if (!(await AccessBearer.findOne({ token: req.token }))) throw "Unauthorized access";
      const cfg = regimeConfig();
      const history = await Regime.find().sort({ day: -1 }).limit(60).lean();
      const today = history[0] || null;
      const on = cfg.force === "on" ? true : cfg.force === "off" ? false : Boolean(today?.on);
      res.status(200).json({ on, force: cfg.force, streakDays: cfg.streakDays, today, history });
    } catch (error) {
      res.status(400).json({ error });
    }
  },
};
