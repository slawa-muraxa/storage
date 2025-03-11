#!/bin/bash

# API base URL
API_URL="http://localhost:3004/api"

# Test data
BUCKET_NAME="l3-rel"
OBJECT_NAME="test/bmp_13m_cfv.zip"

# Function to test the sync-metadata endpoint
test_sync_metadata() {
    echo "Testing sync-dataset-meta endpoint..."

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
        "$API_URL/metadata/sync-dataset")

    # Extract response body and HTTP status code
    status_code=$(echo "$response" | tail -n1)
    response_body=$(echo "$response" | sed '$d')

    # Validate HTTP status
    if [[ $status_code -eq 200 ]]; then
        echo "Sync-metadata successful. HTTP Status: $status_code"
        echo -e "Response:\n$(echo "$response_body" | jq --color-output '.')"

        # Check if the response body is empty
        if [[ -z "$response_body" ]]; then
            echo "Error: Response body is empty."
            exit 1
        fi

        # Parse the JSON response body using jq
        parsed_response=$(echo "$response_body" | jq '.')

        # Ensure response is valid JSON and contains the 'metadata' field
        if echo "$parsed_response" | jq -e 'has("metadata")' > /dev/null; then
            # Extract metadata
            metadata=$(echo "$parsed_response" | jq '.metadata')

            # Validate tags
            tags=$(echo "$metadata" | jq '.tags')
            if [[ $(echo "$tags" | jq 'length') -gt 0 ]]; then
                for tag in $(echo "$tags" | jq -c '.[]'); do
                    name=$(echo "$tag" | jq -r '.name')
                    value=$(echo "$tag" | jq '.value')
                    color=$(echo "$tag" | jq -r '.color')

                    # Exact values for tags validation
                    if [[ "$name" == "tank" && "$value" -eq 89 && "$color" == "#4e3da3" ]] || \
                    [[ "$name" == "ifv" && "$value" -eq 105 && "$color" == "#80ccd5" ]]; then
                        continue
                    else
                        echo "Error: Invalid tag format or values in ID: $(echo "$parsed_response" | jq -r '.id')"
                        exit 1
                    fi
                done
            else
                echo "Error: Tags array is empty for ID: $(echo "$parsed_response" | jq -r '.id')"
                exit 1
            fi

            # Validate attributes
            attributes=$(echo "$metadata" | jq '.attributes')
            if [[ $(echo "$attributes" | jq 'length') -gt 0 ]]; then
                for attr in $(echo "$attributes" | jq -c '.[]'); do
                    name=$(echo "$attr" | jq -r '.name')
                    value=$(echo "$attr" | jq '.value')

                    # Exact values for attributes validation
                    if [[ "$name" == "key_annotations" && "$value" -eq 60 ]] || \
                    [[ "$name" == "total_annotations" && "$value" -eq 194 ]] || \
                    [[ "$name" == "key_frames" && "$value" -eq 53 ]] || \
                    [[ "$name" == "annotated_frames" && "$value" -eq 121 ]] || \
                    [[ "$name" == "total_frames" && "$value" -eq 123 ]]; then
                        continue
                    else
                        echo "Error: Invalid attribute format or values in ID: $(echo "$parsed_response" | jq -r '.id')"
                        exit 1
                    fi
                done
            else
                echo "Error: Attributes array is empty for ID: $(echo "$parsed_response" | jq -r '.id')"
                exit 1
            fi

            echo "Metadata is valid for ID: $(echo "$parsed_response" | jq -r '.id')"
            data_exists=true
        else
            echo "Error: Metadata is missing required fields for ID: $(echo "$parsed_response" | jq -r '.id')"
            exit 1
        fi

    else
        echo "Error: Sync-metadata failed. HTTP Status: $status_code"
        echo "Response: $response_body"
        exit 1
    fi

    #Check if data_exists is still false at the end
    if [[ "$data_exists" == false ]]; then
        echo "Error: No valid metadata found."
        exit 1
    fi
}

# Run the test
test_sync_metadata

echo "Test completed successfully!"
