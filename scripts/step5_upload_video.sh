#!/bin/bash

# API base URL
API_URL="http://localhost:3004/api"

# MinIO client configuration
MINIO_ALIAS="myminio"
MINIO_BUCKET="l1-raw"

# Test data for file upload
CUSTOMER="test2"
DATE="2024-11-21"
FILE_PATH="test/data/bmp_01p.mp4" # Path to the file to be uploaded
OBJECT_NAME="${CUSTOMER}_$(date -j -f "%Y-%m-%d" "$DATE" "+%y%m%d")/bmp_01p.mp4" # Object name format for macOS

# Function to test the file upload, verify with mc, and call sync-minio-structure
test_upload_file() {
    echo "Testing upload file endpoint..."

    # Step 1: Upload the file using the API
    response=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
    -F "files=@${FILE_PATH}" \
    -F "customer=${CUSTOMER}" \
    -F "date=${DATE}" \
    "$API_URL/upload")

    # Extract HTTP status and response body
    response_body=$(echo "$response" | sed '$ d')
    status_code=$(echo "$response" | tail -n1)

    # Step 2: Validate HTTP status
    if [[ $status_code -eq 200 ]]; then
        echo "File uploaded successfully. HTTP Status: $status_code"
        echo "Response: $response_body"
    else
        echo "Error: File upload failed. HTTP Status: $status_code"
        echo "Response: $response_body"
        exit 1
    fi

    # Step 3: Verify file upload using mc
    echo "Verifying $OBJECT_NAME file upload in MinIO..."
    mc ls $MINIO_ALIAS/$MINIO_BUCKET/$OBJECT_NAME

    if [[ $? -eq 0 ]]; then
        echo "File successfully uploaded to MinIO."
    else
        echo "Error: File not found in MinIO."
        exit 1
    fi

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

    # Validate the number of objects in the response
    if [[ $fetch_status_code -eq 200 && $object_count -eq 4 ]]; then
        echo "sync-minio-structure successful. 4 objects found."
    else
        echo "Error: sync-minio-structure failed. HTTP Status: $fetch_status_code"
        exit 1
    fi
}

# Run the test
test_upload_file

echo "Test completed successfully!"