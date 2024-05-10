import mongoose, {Document, Schema} from "mongoose";

export interface AccessBearer {
    created_at: Date; 
    token: string; // JWT token
    username: string;
}

export interface AccessBearerDocument extends AccessBearer, Document {}

const AccessBearerSchema = new Schema({
    created_at: {
        type: Date,
        default: Date.now
    },
    token: {
        type: String,
        required: true,
        unique: true
    },
    username: {
        type: String,
        required: true
    }

});

export default mongoose.model<AccessBearerDocument>("AccessBearer", AccessBearerSchema);

