#!/bin/bash

# Configuration
ENDPOINT="http://localhost:3004/api/cut-selection" # Replace with your actual endpoint
BUCKET_NAME="l1-raw"
OBJECT_NAME="test/bmp_13m.mp4" # Replace with the name of your test video in MinIO
SELECTIONS='[{"from":10,"to":20},{"from":30,"to":40}]' # Replace with test selections
MC_ALIAS="myminio" # Replace with your mc alias
PROCESSED_OBJECT=""

# Step 1: Test the cut-selection endpoint
echo "Sending POST request to $ENDPOINT..."
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -d '{
        "bucketName": "'$BUCKET_NAME'",
        "objectName": "'$OBJECT_NAME'",
        "selections": '$SELECTIONS'
    }')

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | awk -F":" '{print $2}')
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE:/d')

if [ "$HTTP_CODE" -ne 200 ]; then
    echo "Error: Endpoint returned HTTP $HTTP_CODE"
    echo "Response: $BODY"
    exit 1
fi

# Extract the processed object name from the response
PROCESSED_OBJECT=$(echo "$BODY" | jq -r '.processedObjectName')

if [ -z "$PROCESSED_OBJECT" ]; then
    echo "Error: No processed object name returned from the server."
    exit 1
fi

echo "Endpoint responded successfully: $BODY"
echo "Processed object name: $PROCESSED_OBJECT"

# Step 2: Validate the processed file exists in MinIO
echo "Validating processed file in MinIO..."
mc stat "$MC_ALIAS/$BUCKET_NAME/$PROCESSED_OBJECT" > /dev/null 2>&1

if [ $? -ne 0 ]; then
    echo "Error: Processed file $PROCESSED_OBJECT not found in MinIO bucket $BUCKET_NAME"
    exit 1
fi

echo "Processed file $PROCESSED_OBJECT found in MinIO."

# Step 3: Compare file sizes
echo "Fetching file sizes for comparison..."
ORIGINAL_SIZE=$(mc stat "$MC_ALIAS/$BUCKET_NAME/$OBJECT_NAME" | grep "Size" | awk '{print $2}')
PROCESSED_SIZE=$(mc stat "$MC_ALIAS/$BUCKET_NAME/$PROCESSED_OBJECT" | grep "Size" | awk '{print $2}')

echo "Original file size: $ORIGINAL_SIZE bytes"
echo "Processed file size: $PROCESSED_SIZE bytes"

if [ "$PROCESSED_SIZE" -ge "$ORIGINAL_SIZE" ]; then
    echo "Error: Processed file size ($PROCESSED_SIZE bytes) is not smaller than original file size ($ORIGINAL_SIZE bytes). Cutting may have failed."
    exit 1
fi

echo "Success: Processed file size is smaller than the original file size."
