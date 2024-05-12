## API Documentation

Welcome to our API documentation! This guide provides detailed instructions on how to interact with our API endpoints. Each endpoint requires authentication using a bearer token.

### Table of Contents
- **[Create Wallet](#create-wallet)**
- **[List Wallets](#list-wallets)**
- **[Get User Information](#get-user-information)**
- **[Delete User](#delete-user)**
- **[Create User](#create-user)**
- **[Recent Transactions](#recent-transactions)**

---

### Create Wallet
#### **Endpoint: `/wallet/create` [POST]**

**Required:** Bearer token authentication.

**Payload:**
{
  "username": "your_username",
  "wallets": ["wallet_address1", "wallet_address2"]
}

**Functionality:**
Creates a wallet for the provided username. If the username already exists, this endpoint will add new wallets to the existing account.

**Response:**
{
  "wallet_details": "details_here"
}

---

### List Wallets
#### **Endpoint: `/wallet/list` [GET]**

**Required:** Bearer token authentication.

**Functionality:**
Returns a list of all created wallets.

**Response:**
{
  "wallets": ["wallet1_details", "wallet2_details"]
}

---

### Get User Information
#### **Endpoint: `/user/get` [POST]**

**Required:** Bearer token authentication.

**Payload:**
{
  "username": "your_username"
}

**Functionality:**
Fetches and returns information about a user.

**Response:**
{
  "user_info": "details_here"
}

---

### Delete User
#### **Endpoint: `/user/delete` [POST]**

**Required:** Bearer token authentication.

**Payload:**
{
  "username": "your_username"
}

**Functionality:**
Deletes a user based on the provided username.

---

### Create User
#### **Endpoint: `/user/create` [POST]**

**Required:** Bearer token authentication.

**Payload:**
{
  "username": "your_username"
}

**Functionality:**
Creates a new user and generates a JWT for them.

**Response:**
{
  "_id": "unique_user_id",
  "username": "username",
  "token": "jwt_token"
}

---

### Recent Transactions
#### **Endpoint: `/wallet/transaction/recent` [GET]**

**Required:** Bearer token authentication.

**Functionality:**
Retrieves transactions from the last 24 hours across different wallets.

**Response:**
[
    {
        "username": "username",
        "wallet": "wallet_address",
        "tokenSymbol": "token_symbol",
        "hash": "transaction_hash",
        "gasUsed": "gas_used"
    },
    {...}
]

---
