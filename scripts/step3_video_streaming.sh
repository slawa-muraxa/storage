#!/bin/bash

# API base URL
API_URL="http://localhost:3004/api/stream/l1"

# File to test streaming
TEST_FILE="test/bmp_13p.mp4"

# Temporary files for validation
FULL_RESPONSE="full_response.mp4"
PARTIAL_RESPONSE="partial_response.mp4"

# Function to perform a full request
test_full_request() {
    echo "Testing full video stream..."
    curl -s -o $FULL_RESPONSE -D - "$API_URL?fileName=$TEST_FILE"

    # Validate the content type
    content_type=$(file --mime-type -b $FULL_RESPONSE)
    if [[ $content_type == "video/mp4" ]]; then
        echo "Full video stream successful. Content-Type: $content_type"
    else
        echo "Error: Unexpected content type for full stream: $content_type"
        exit 1
    fi
}

# Function to perform a partial request
test_partial_request() {
    echo "Testing partial video stream..."
    # Set the end of the range to the argument passed or default to 99999
    END_RANGE=${1:-}
    EXPECTED_LENGTH=${2:-5126806}
    RANGE="bytes=0-$END_RANGE"

    curl -s -o $PARTIAL_RESPONSE -D - -H "Range: $RANGE" "$API_URL?fileName=$TEST_FILE"

    # Validate the HTTP status code
    status_code=$(curl -s -o /dev/null -w "%{http_code}" -H "Range: $RANGE" "$API_URL?fileName=$TEST_FILE")
    if [[ $status_code -eq 206 ]]; then
        echo "Partial video stream successful. HTTP Status: $status_code"
    else
        echo "Error: Partial video stream failed. HTTP Status: $status_code"
        exit 1
    fi

    # Validate the content length
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS-compatible stat command
        content_length=$(stat -f%z "$PARTIAL_RESPONSE")
    else
        # Linux-compatible stat command
        content_length=$(stat -c%s "$PARTIAL_RESPONSE")
    fi

    if [[ $content_length -eq $EXPECTED_LENGTH ]]; then
        echo "Partial video stream length validated: $content_length bytes"
    else
        echo "Error: Unexpected length for partial stream: $content_length bytes"
        exit 1
    fi
}

# Function to clean up temporary files
cleanup() {
    echo "Cleaning up temporary files..."
    rm -f $FULL_RESPONSE $PARTIAL_RESPONSE
}

# Run tests
test_full_request
test_partial_request
test_partial_request 9999 10000
cleanup

echo "All tests passed successfully!"