#!/bin/bash

# API base URL
API_URL="http://localhost:3004/api/sync-metadata"

# Test data
BUCKET_NAME="l1-raw"
OBJECT_NAME="test/bmp_13p.mp4"

# Function to test the sync-metadata endpoint
test_sync_metadata() {
    echo "Testing sync-metadata endpoint..."

    # Prepare the JSON payload
    payload=$(cat <<EOF
{
    "bucketName": "$BUCKET_NAME",
    "objectName": "$OBJECT_NAME"
}
EOF
    )

    # Send the POST request and capture both the response body and status code
    response=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
        -d "$payload" \
        "$API_URL")

    # Extract response body and HTTP status code
    response_body=$(echo "$response" | sed '$ d')
    status_code=$(echo "$response" | tail -n1)

    # Parse the JSON response body using jq
    parsed_response=$(echo "$response_body" | jq '.')

    # Validate HTTP status
    if [[ $status_code -eq 200 ]]; then
        echo "Sync-metadata successful. HTTP Status: $status_code"
        echo "Response: $parsed_response"

        # Assert metadata is valid
        metadata=$(echo "$response_body" | jq '.metadata.video')
        if [[ $(echo "$metadata" | jq 'has("length")') == "true" && \
              $(echo "$metadata" | jq 'has("bitRate")') == "true" && \
              $(echo "$metadata" | jq 'has("codec")') == "true" && \
              $(echo "$metadata" | jq 'has("fps")') == "true" && \
              $(echo "$metadata" | jq 'has("numberOfFrames")') == "true" && \
              $(echo "$metadata" | jq 'has("width")') == "true" && \
              $(echo "$metadata" | jq 'has("height")') == "true" && \
              $(echo "$metadata" | jq 'has("quality")') == "true" && \
              $(echo "$metadata" | jq '.quality | has("qualityScore")') == "true" && \
              $(echo "$metadata" | jq '.quality | has("qualityDescription")') == "true" && \
              $(echo "$metadata" | jq '.quality | has("bitRatePerFrame")') == "true" && \
              $(echo "$metadata" | jq '.quality | has("bitrateRatio")') == "true" ]]; then
            echo "Metadata is valid."
        else
            echo "Error: Metadata is missing required fields."
            exit 1
        fi
    else
        echo "Error: Sync-metadata failed. HTTP Status: $status_code"
        echo "Response: $parsed_response"
        exit 1
    fi
}

# Run the test
test_sync_metadata

echo "Test completed successfully!"