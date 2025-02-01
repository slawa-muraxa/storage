#!/bin/bash

# API base URL
API_URL="http://localhost:3004/api"

# Test data
BUCKET_NAME="l1-raw"
OBJECT_NAME="test/bmp_13p.mp4"

# Function to test the sync-metadata endpoint
test_sync_metadata() {
    echo "Testing sync-metadata endpoint..."

    # Initialize the data_exists variable to false
    data_exists=false

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
        "$API_URL/sync-metadata")

    # Ensure sync is not rewriting
    sync_response=$(curl -s -X GET "$API_URL/sync-minio-structure" \
    -H "Authorization: Bearer <your_token>" \
    -H "Content-Type: application/json")    

    # Extract response body and HTTP status code
    status_code=$(echo "$response" | tail -n1)

    # Parse the JSON response body using jq
    parsed_response=$(echo "$sync_response" | jq '.')

    # Validate HTTP status
    if [[ $status_code -eq 200 ]]; then
        echo "Sync-metadata successful. HTTP Status: $status_code"
        echo -e "Response:\n$(echo "$parsed_response" | jq --color-output '.')"

        # Iterate through each item in the l1-raw array
        for item in $(echo "$sync_response" | jq -c '.["l1-raw"][]'); do
            # Check if metadata.video exists
            if echo "$item" | jq -e '.metadata.video?' > /dev/null; then
                metadata=$(echo "$item" | jq '.metadata.video')
                # Validate all required fields
                if [[ $(echo "$metadata" | jq '.length') == 13.119274 && \
                    $(echo "$metadata" | jq '.bitRate') == 3126274 && \
                    $(echo "$metadata" | jq -r '.codec') == "h264" && \
                    $(echo "$metadata" | jq '.fps') == 25.108140532323105 && \
                    $(echo "$metadata" | jq '.numberOfFrames') == 329 && \
                    $(echo "$metadata" | jq '.width') == 1280 && \
                    $(echo "$metadata" | jq '.height') == 720 && \
                    $(echo "$metadata" | jq -r 'has("quality")') == "true" && \
                    $(echo "$metadata" | jq '.quality.qualityScore') == 2 && \
                    $(echo "$metadata" | jq -r '.quality.qualityDescription') == "Low" && \
                    $(echo "$metadata" | jq '.quality.bitRatePerFrame') == 0.12451236665556231 && \
                    $(echo "$metadata" | jq '.quality.bitrateRatio') == 0.6252548 ]]; then
                    echo "Metadata is valid for ID: $(echo "$item" | jq -r '.id')"
                    data_exists=true
                else
                    echo "Error: Metadata is not correct for ID: $(echo "$item" | jq -r '.id')"
                    exit 1
                fi
            fi
        done

    else
        echo "Error: Sync-metadata failed. HTTP Status: $status_code"
        echo "Response: $parsed_response"
        exit 1
    fi

    # Check if data_exists is still false at the end
    if [[ "$data_exists" == false ]]; then
        echo "Error: No valid metadata found."
        exit 1
    fi
}

# Run the test
test_sync_metadata

echo "Test completed successfully!"