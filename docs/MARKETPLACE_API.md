# Marketplace API Documentation

## Overview

The ForgeMind marketplace API enables users to create, browse, and manage listings for cosplay items and services. The marketplace supports three transaction types: selling items, trading items, and offering commission services.

## Transaction Types

### 1. Sell (`post_type: 'sell'`)
List an item for sale at a fixed price.

**Requirements:**
- User role: `seller`
- Must have: `price` (> 0), `category`, `condition`
- Category: Item categories only (Wigs, Fabric & Materials, Props & Accessories, Costumes & Cosplay)

**Example:**
```json
{
  "post_type": "sell",
  "title": "Heat resistant white wig base",
  "description": "Cosplay wig cap, unused, heat styling friendly.",
  "price": 350,
  "category": "Wigs",
  "condition": "like_new"
}
```

### 2. Trade (`post_type: 'trade'`)
Offer to trade one item for another.

**Requirements:**
- User role: `seller` or `buyer` (anyone can trade)
- Must have: `trade_offered_item`, `trade_wanted_item`, `category`, `condition`
- Category: Item categories only

**Example:**
```json
{
  "post_type": "trade",
  "title": "Trading a cosplay wig for a styled collar",
  "description": "Unused black cosplay wig, looking for a detachable collar in return.",
  "trade_offered_item": "Unused black cosplay wig",
  "trade_wanted_item": "Detachable cosplay collar",
  "category": "Wigs",
  "condition": "good"
}
```

### 3. Commission (`post_type: 'commission'`)
Offer a service at an hourly or per-project rate.

**Requirements:**
- User role: `seller`
- Must have: `rate` (> 0), `category`
- Category: Service categories only (Wig Styling, Costume Making, Prop Fabrication, Photography)
- Condition: Optional (defaults to `good`)

**Example:**
```json
{
  "post_type": "commission",
  "title": "Wig styling, cutting and heat set service",
  "description": "Styling and heat setting for cosplay wigs, same day service.",
  "rate": 250,
  "category": "Wig Styling"
}
```

## Categories

### Item Categories
- **Wigs** - Wigs and wig accessories
- **Fabric & Materials** - Fabric, foam, thread, and raw materials
- **Props & Accessories** - Props, weapons, accessories, and finishing touches
- **Costumes & Cosplay** - Complete costumes and cosplay outfits

### Service Categories
- **Wig Styling** - Wig cutting, styling, and heat setting services
- **Costume Making** - Custom costume construction services
- **Prop Fabrication** - Prop building and finishing services
- **Photography** - Cosplay photography and editing services

**Note:** The "Other" category has been retired and is no longer available for new listings.

## Listing States

- **active** - Listing is visible in the marketplace feed
- **blocked** - Listing was held for review by the moderation system
- **cancelled** - Listing was removed by the owner
- **sold** - Listing was marked as sold/completed

## Endpoints

### POST /marketplace/listings
Create a new listing.

**Authentication:** Required (session token)

**Request Body:** See transaction type examples above

**Response:**
```json
{
  "listing": {
    "id": "uuid",
    "post_type": "sell",
    "title": "Heat resistant white wig base",
    "description": "Cosplay wig cap, unused, heat styling friendly.",
    "price": 350,
    "category": "Wigs",
    "condition": "like_new",
    "status": "active",
    "screening_result": "passed",
    "created_at": "2026-10-03T10:00:00Z"
  }
}
```

**Status Codes:**
- `201` - Listing created successfully
- `400` - Invalid input (missing fields, invalid type/category combination, price/rate = 0)
- `401` - Not authenticated
- `403` - Role not permitted for this transaction type

### GET /marketplace/listings
Browse active marketplace listings.

**Authentication:** Required (session token)

**Query Parameters:**
- `limit` (optional, default 20, max 50) - Number of listings to return
- `offset` (optional, default 0) - Pagination offset

**Response:**
```json
{
  "listings": [
    {
      "id": "uuid",
      "post_type": "sell",
      "title": "Heat resistant white wig base",
      "description": "Cosplay wig cap, unused, heat styling friendly.",
      "price": 350,
      "category": "Wigs",
      "condition": "like_new",
      "status": "active",
      "seller_username": "cosplayer123",
      "created_at": "2026-10-03T10:00:00Z"
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

**Notes:**
- Only shows `active` listings
- Does not expose `screening_reason`, `screening_result`, `appeal_status`, or seller email
- Blocked and cancelled listings are hidden from the public feed

**Status Codes:**
- `200` - Success
- `401` - Not authenticated
- `400` - Invalid query parameters

### GET /marketplace/listings/mine
Get the current user's own listings (all states).

**Authentication:** Required (session token)

**Response:**
```json
{
  "listings": [
    {
      "id": "uuid",
      "post_type": "sell",
      "title": "Heat resistant white wig base",
      "status": "active",
      "screening_result": "passed",
      "screening_reason": null,
      "appeal_status": "none",
      "created_at": "2026-10-03T10:00:00Z"
    }
  ]
}
```

**Notes:**
- Shows all listing states: active, blocked, cancelled, sold
- Exposes `appeal_status` and `screening_reason` fields for the owner
- Owner can see their own blocked listings with moderation feedback

**Status Codes:**
- `200` - Success
- `401` - Not authenticated

### POST /marketplace/listings/:id/remove
Remove a listing (mark as cancelled).

**Authentication:** Required (session token, must be listing owner)

**Request Body:**
```json
{
  "removed_reason": "no_longer_available"
}
```

**Valid reasons:**
- `no_longer_available` - Item/service no longer available
- `sold_elsewhere` - Item sold outside the platform
- (empty/omitted) - No reason specified

**Notes:**
- Works on both `active` and `blocked` listings
- Removing a `blocked` listing automatically clears any pending appeals
- Cannot remove listings that are already `cancelled` or `sold`

**Status Codes:**
- `200` - Listing removed successfully
- `400` - Invalid removal reason
- `401` - Not authenticated
- `403` - Not the listing owner
- `409` - Listing already cancelled or sold

### POST /marketplace/listings/:id/sold
Mark a listing as sold/completed.

**Authentication:** Required (session token, must be listing owner)

**Request Body:** (empty or `{}`)

**Notes:**
- Only works on `active` listings
- Cannot mark `blocked`, `cancelled`, or already `sold` listings

**Status Codes:**
- `200` - Listing marked sold successfully
- `401` - Not authenticated
- `403` - Not the listing owner
- `409` - Listing not active (already sold, cancelled, or blocked)

### POST /marketplace/listings/:id/appeal
Appeal a blocked listing.

**Authentication:** Required (session token, must be listing owner)

**Request Body:**
```json
{
  "message": "Please review, this is a harmless costume prop."
}
```

**Notes:**
- Only works on `blocked` listings with `screening_result: 'blocked'`
- Cannot appeal `active`, `cancelled`, or `sold` listings
- Message is required and cannot be empty
- Sets `appeal_status` to `pending`

**Status Codes:**
- `200` - Appeal submitted successfully
- `400` - Empty or missing message
- `401` - Not authenticated
- `403` - Not the listing owner
- `409` - Listing is not blocked or already has a resolved appeal

## Role-Based Posting Rules

| Transaction Type | Seller Role | Buyer Role |
|-----------------|-------------|------------|
| Sell | ✓ Allowed | ✗ Forbidden (403) |
| Trade | ✓ Allowed | ✓ Allowed |
| Commission | ✓ Allowed | ✗ Forbidden (403) |

## Validation Rules

### All Listings
- `title`: Required, non-empty string
- `description`: Required, non-empty string
- `category`: Required, must be a permitted category slug

### Sell Listings
- `price`: Required, must be > 0
- `condition`: Required, must be valid condition value
- Category: Must be an item category (not a service category)

### Trade Listings
- `trade_offered_item`: Required, non-empty string
- `trade_wanted_item`: Required, non-empty string
- `condition`: Required, must be valid condition value
- Category: Must be an item category (not a service category)

### Commission Listings
- `rate`: Required, must be > 0
- `condition`: Optional (defaults to `good`)
- Category: Must be a service category (not an item category)

## Condition Values

- `new` - Brand new, never used
- `like_new` - Gently used, excellent condition
- `good` - Used, good working condition
- `fair` - Used, shows wear but functional
- `poor` - Heavy wear, may need repair

## Error Responses

All error responses follow this format:

```json
{
  "error": "Error message describing what went wrong"
}
```

Common error scenarios:

- **400 Bad Request** - Invalid input (missing required fields, invalid values, type/category mismatch)
- **401 Unauthorized** - No session token or invalid session
- **403 Forbidden** - User role not permitted for this action
- **404 Not Found** - Listing ID does not exist
- **409 Conflict** - Action not allowed in current listing state

## Moderation

All listings are automatically screened when created. The system checks:

1. **Rule-based validation** - Title, description, category, price/rate, condition
2. **Content moderation** - Prohibited words, inappropriate content (future: ML-based screening)

Listings that pass screening appear immediately with `status: 'active'`. Listings that fail are created with `status: 'blocked'` and `screening_result: 'blocked'`. The owner can see the `screening_reason` in their `/mine` feed and file an appeal.

## Retired Transaction Types

The following transaction types were removed and are no longer supported:

- **buy** - Buy requests (use trade instead)
- **rent** - Rental listings
- **service_offer** - Generic service offers (use commission instead)
- **service_request** - Service requests

Attempting to create a listing with these types returns `400 Bad Request`.

## Examples

### Creating a Sell Listing
```bash
curl -X POST http://localhost:3000/marketplace/listings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <session-token>" \
  -d '{
    "post_type": "sell",
    "title": "Red fabric bolt, 5 yards",
    "description": "High-quality red satin fabric, perfect for capes and costumes.",
    "price": 500,
    "category": "Fabric & Materials",
    "condition": "new"
  }'
```

### Browsing Listings
```bash
curl -X GET "http://localhost:3000/marketplace/listings?limit=10&offset=0" \
  -H "Authorization: Bearer <session-token>"
```

### Removing a Listing
```bash
curl -X POST http://localhost:3000/marketplace/listings/<listing-id>/remove \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <session-token>" \
  -d '{
    "removed_reason": "sold_elsewhere"
  }'
```

### Appealing a Blocked Listing
```bash
curl -X POST http://localhost:3000/marketplace/listings/<listing-id>/appeal \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <session-token>" \
  -d '{
    "message": "This is a legitimate cosplay prop, not a real weapon. Please review."
  }'
```

## Version History

- **2026-10-03** - Three transaction types (sell/trade/commission), category expansion, enhanced owner remove
- **2026-09-XX** - Initial marketplace implementation
