import express from "express";
import AccessBearer from "../../database/models/AccessBearer";

export default {
    name: "/user/get",
    description: "Get a user",
    method: "POST",
    run: async (req: express.Request, res: express.Response) => {
        try {
            if(!req.token) throw "Unauthorized access, missing 'token' in request header"
            if(!await AccessBearer.findOne({token: req.token})) throw "Unauthorized access"
            if(!req.body.username) throw "Missing parameters in request body for getting a user, missing 'username'"
            if(typeof req.body.username !== "string") throw "Invalid parameters in request body for getting a user, username is not a string"

            const user = await AccessBearer.findOne({username: req.body.username})
            if(user) {
                res.status(200)
                res.send({user_info: user})
            } else {
                res.status(200)
                res.json({error: "User not found"}) 
            }
        }

        catch(err) {
            res.status(400)
            res.json({error: err});
        }
    }
}