#!/bin/bash

# API base URL (adjust this if your API is running on a different port)
API_URL="http://localhost:3004/api"

# MongoDB connection details
MONGO_HOST="localhost"
MONGO_PORT="37017"
DB_NAME="storage"
COLLECTION_NAME="storage.l1-raw.objects"

# Function to check if a required field is present
check_field() {
    local json=$1
    local field=$2
    echo "$json" | jq -e "$field" > /dev/null 2>&1
    if [ $? -ne 0 ]; then
        echo "Error: Required field $field is missing or invalid."
        exit 1
    fi
}

# Function to validate API response structure
validate_response() {
    local response=$1
    echo "Validating response structure..."
    check_field "$response" '.["l1-raw"]'  # Ensure "l1-raw" exists
    local count=$(echo "$response" | jq '.["l1-raw"] | length')

    if [ $count -eq 0 ]; then
        echo "Error: 'l1-raw' contains no objects."
        exit 1
    fi

    echo "'l1-raw' contains $count objects. Validating object properties..."

    # Validate properties of each object
    echo "$response" | jq -c '.["l1-raw"][]' | while read -r object; do
        check_field "$object" '.id'
        check_field "$object" '.active'
        check_field "$object" '.etag'
        check_field "$object" '.name'
        check_field "$object" '.size'

        echo "Object validated: $(echo "$object" | jq -r '.id')"
    done

    echo "All objects in 'l1-raw' are valid."
}

echo "Running test: sync-minio-structure"
sync_response=$(curl -s -X GET "$API_URL/sync-minio-structure" \
    -H "Authorization: Bearer <your_token>" \
    -H "Content-Type: application/json")

if [ -z "$sync_response" ]; then
    echo "Error: No response received from sync-minio-structure API."
    exit 1
fi

# Parse and validate the response from sync-minio-structure
echo "Parsed response from sync-minio-structure:"
echo "$sync_response" | jq .
validate_response "$sync_response"

echo "Running test: fetch-minio-structure"
fetch_response=$(curl -s -X GET "$API_URL/fetch-minio-structure" \
    -H "Authorization: Bearer <your_token>" \
    -H "Content-Type: application/json")

if [ -z "$fetch_response" ]; then
    echo "Error: No response received from fetch-minio-structure API."
    exit 1
fi

# Parse and validate the response from fetch-minio-structure
echo "Parsed response from fetch-minio-structure:"
echo "$fetch_response" | jq .
validate_response "$fetch_response"

# Compare the two responses
echo "Comparing responses from sync-minio-structure and fetch-minio-structure..."
if diff <(echo "$sync_response" | jq -S .) <(echo "$fetch_response" | jq -S .) > /dev/null; then
    echo "Responses from sync-minio-structure and fetch-minio-structure match."
else
    echo "Error: Responses from sync-minio-structure and fetch-minio-structure do not match!"
    exit 1
fi

# If using mongosh to list all collections:
echo "Listing all collections in the '$DB_NAME' database via mongosh..."
mongosh "mongodb://$MONGO_HOST:$MONGO_PORT/$DB_NAME" --eval "show collections"

# If using mongosh to read collection directly:
echo "Reading from MongoDB via mongosh..."
mongosh "mongodb://$MONGO_HOST:$MONGO_PORT/$DB_NAME" --eval "printjson(db['$COLLECTION_NAME'].find().toArray())"