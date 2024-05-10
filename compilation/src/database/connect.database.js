"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const logger_1 = __importDefault(require("../logger"));
const config_1 = require("../../config");
const sequelize_1 = require("sequelize");
mongoose_1.default.set('strictQuery', false);
function DB_Connect() {
    return new Promise((resolve, reject) => {
        var _a;
        const dbType = (_a = process.env.DB_TYPE) === null || _a === void 0 ? void 0 : _a.toLowerCase();
        if (dbType === 'mongo') {
            mongoose_1.default.set('strictQuery', false);
            mongoose_1.default
                .connect(config_1.config.mongo.url, { retryWrites: true, w: 'majority' })
                .then(() => {
                logger_1.default.success(`Connected to MongoDB database called ${config_1.config.mongo.username}.`);
                logger_1.default.beautifulSpace();
                resolve();
            })
                .catch((error) => {
                logger_1.default.fatal("Failed to connect to MongoDB, exiting... ");
                logger_1.default.warn("Please check your MongoDB configuration in the environment file (.env)");
                reject(error);
            });
        }
        else if (dbType === 'sql') {
            const sequelize = new sequelize_1.Sequelize(config_1.config.sql.database, config_1.config.sql.username, config_1.config.sql.password, {
                host: config_1.config.sql.host,
                port: config_1.config.sql.port,
                dialect: 'mysql'
            });
            sequelize.authenticate()
                .then(() => {
                logger_1.default.success(`Connected to SQL database called ${config_1.config.sql.database}.`);
                logger_1.default.beautifulSpace();
                resolve();
            })
                .catch((error) => {
                logger_1.default.fatal("Failed to connect to SQL database, exiting... ");
                logger_1.default.warn("Please check your SQL database configuration in the environment file (.env)");
                reject(error);
            });
        }
        else {
            logger_1.default.fatal(`Unknown DB_TYPE '${dbType}' in .env file.`);
            reject(new Error(`Unknown DB_TYPE '${dbType}'`));
        }
    });
}
exports.default = DB_Connect;
