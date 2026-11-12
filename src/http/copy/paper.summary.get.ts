// src/http/copy/paper.summary.get.ts

import express from "express";
import AccessBearer from "../../database/models/AccessBearer";
import { paperSummary } from "../../autoload/paper";

export default {
  name: "/copy/paper/summary",
  description: "Paper trading of the copy signals: open positions + realized stats by regime",
  method: "GET",
  run: async (req: express.Request, res: express.Response) => {
    try {
      if (!req.token) throw "Unauthorized access, missing 'token' in request header";
      if (!(await AccessBearer.findOne({ token: req.token }))) throw "Unauthorized access";
      res.status(200).json(await paperSummary());
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  },
};
