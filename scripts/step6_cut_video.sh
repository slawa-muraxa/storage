#!/bin/bash

# Configuration
API_URL="http://localhost:3004/api" # API base URL
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

echo "Response: $BODY"

if [ "$HTTP_CODE" -ne 200 ]; then
    echo "Error: Endpoint returned HTTP $HTTP_CODE"
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

# Step 4: Call sync-minio-structure and validate response
echo "Calling sync-minio-structure endpoint..."
fetch_response=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/sync-minio-structure" \
-H "Authorization: Bearer YOUR_AUTH_TOKEN" \
-H "Content-Type: application/json")

# Extract response body and status code
fetch_response_body=$(echo "$fetch_response" | sed '$ d')
fetch_status_code=$(echo "$fetch_response" | tail -n1)

# Pretty print the response body
echo "Formatted JSON Response from sync-minio-structure:"
echo "$fetch_response_body" | jq

# Validate the number of objects in the l1-raw bucket
object_count=$(echo "$fetch_response_body" | jq '.["l1-raw"] | length')

# Validate the number of objects in the l1-preview bucket
preview_count=$(echo "$fetch_response_body" | jq '.["l1-preview"] | length')

# Validate the proper amount of target
targets_count=$(echo "$fetch_response_body" | jq '[.["l1-raw"][], .["l1-preview"][] | .targets | length] | add')

# Validate the proper amount of target
sources_count=$(echo "$fetch_response_body" | jq '[.["l1-raw"][], .["l1-preview"][] | .sources | length] | add')

# Validate the number of targets in the response
if [[ $fetch_status_code -eq 200 && $targets_count -eq 4 ]]; then
    echo "sync-minio-structure successful. 4 targets found."
else
    echo "Error: updated targets mismatch $targets_count" 
    exit 1
fi

# Validate the number of sources in the response
if [[ $fetch_status_code -eq 200 && $sources_count -eq 4 ]]; then
    echo "sync-minio-structure successful. 4 source found."
else
    echo "Error: updated sources mismatch $sources_count"
    exit 1
fi

# Validate the number of objects in the response
if [[ $fetch_status_code -eq 200 && $object_count -eq 6 ]]; then
    echo "sync-minio-structure successful. 6 raw objects found."
else
    echo "Error: raw objects mismatch $object_count"
    exit 1
fi

# Validate the number of objects in the response
if [[ $fetch_status_code -eq 200 && $preview_count -eq 3 ]]; then
    echo "sync-minio-structure successful. 3 preview object found."
else
    echo "Error: preview objects mismatch $preview_count"
    exit 1
fi

echo "Success"
