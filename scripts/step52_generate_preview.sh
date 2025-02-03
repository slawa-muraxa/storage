#!/bin/bash

# API base URL
ENDPOINT="http://localhost:3004/api/create-preview"
API_URL="http://localhost:3004/api"

# MinIO client configuration
MINIO_ALIAS="myminio"
MINIO_BUCKET="l1-raw"

# Test data for file upload
CUSTOMER="test2"
DATE="2024-11-21"
METADATA='[{"created":"2025-01-23T20:16:52.174Z", "preview":false}]'
FILE_PATH="scripts/data/bmp_13m.mp4" # Path to the file to be uploaded
OBJECTS='{"objectNames": ["test/bmp_13m.mp4", "test/bmp_13o.mp4"]}' # Object name format for macOS

# Function to test the file upload, verify with mc, and call sync-minio-structure
test_upload_file() {
    echo "Testing upload file endpoint..."

    # Step 1: Upload the file using the API
    response=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$ENDPOINT" \
        -H "Content-Type: application/json" \
        --data-raw "$OBJECTS" )

    # Extract HTTP status and response body
    response_body=$(echo "$response" | sed '$ d')   # Everything except last line (HTTP status)
    status_code=$(echo "$response" | tail -n1 | sed 's/HTTP_CODE://')   # Extract the HTTP code

    # Step 2: Validate HTTP status
    if [ "$status_code" -eq 201 ]; then   # Compare as numbers
        echo "Preview generated successfully. HTTP Status: $status_code"
        echo "Response: $response_body"
    else
        echo "Error: Preview failed. HTTP Status: $status_code"
        echo "Response: $response_body"
        exit 1
    fi

    # Step 3: Call sync-minio-structure and validate response
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
    targets_count=$(echo "$fetch_response_body" | jq '[.["l1-raw"][], .["l1-preview"][] | select(.targets | length == 1)] | length')

    # Validate the proper amount of target
    sources_count=$(echo "$fetch_response_body" | jq '[.["l1-raw"][], .["l1-preview"][] | select(.sources | length == 1)] | length')

    # Validate the number of sources in the response
    if [ "$fetch_status_code" -eq 200 ] && [ "$sources_count" -eq 3 ]; then
        echo "sync-minio-structure successful. 3 sources found."
    else
        echo "Error: updated targets mismatch"
        exit 1
    fi

    # Validate the number of targets in the response
    if [ "$fetch_status_code" -eq 200 ] && [ "$targets_count" -eq 3 ]; then
        echo "sync-minio-structure successful. 3 targets found."
    else
        echo "Error: updated targets mismatch"
        exit 1
    fi

    # Validate the number raw of objects in the response
    if [ "$fetch_status_code" -eq 200 ] && [ "$object_count" -eq 5 ]; then
        echo "sync-minio-structure successful. 5 raw objects found."
    else
        echo "Error: raw objects mismatch"
        exit 1
    fi

    # Validate the number of preview objects in the response
    if [ "$fetch_status_code" -eq 200 ] && [ "$preview_count" -eq 3 ]; then
        echo "sync-minio-structure successful. 3 preview object found."
    else
        echo "Error: preview objects mismatch"
        exit 1
    fi
}

# Run the test
test_upload_file

echo "Test completed successfully!"