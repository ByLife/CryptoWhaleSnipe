import express from "express";
import AccessBearer from "../../database/models/AccessBearer";

export default {
    name: "/user/create",
    description: "Create a user",
    method: "POST",
    run: async (req: express.Request, res: express.Response) => {
        try {
            if(!req.token) throw "Unauthorized access, missing 'token' in request header"
            if(!await AccessBearer.findOne({token: req.token})) throw "Unauthorized access"
            if(!req.body.username) throw "Missing parameters in request body for creating a user"
            if(typeof req.body.username !== "string") throw "Invalid parameters in request body for creating a user, missing 'username'"

            const user = await AccessBearer.findOne({username: req.body.username})
            if(user) {
                res.status(200)
                res.send(user)
            } else {
                const jwt = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".split("").sort(() => Math.random() - 0.5).join("").slice(0, 64)
                const newUser = new AccessBearer({
                    username: req.body.username,
                    token: jwt
                })
                await newUser.save()
                res.status(200)
                res.send(newUser)
            }
        }

        catch(err) {
            res.status(400)
            res.json({error: err});
        }
    }
}