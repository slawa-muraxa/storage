#!/bin/bash

# Base API URL
API_URL="http://localhost:3004/api/tags"

# MongoDB connection details
MONGO_HOST="localhost:37017"
MONGO_DB="storage"
MONGO_COLLECTION="tags"

# Authorization token (replace with an actual token)
AUTH_TOKEN="<auth-token>"

# Function to clean up MongoDB collection
cleanup_mongodb() {
  echo "Cleaning up MongoDB collection '$MONGO_COLLECTION' in database '$MONGO_DB'..."
  mongosh --quiet --host $MONGO_HOST --eval "
    db = connect('mongodb://$MONGO_HOST/$MONGO_DB');
    db.getCollection('$MONGO_COLLECTION').deleteMany({});
    print('Cleanup completed: All tags deleted.');
  "
}

# Function to test GET /tags
test_get_tags() {
  echo "Testing GET /tags..."
  response=$(curl -X GET "$API_URL" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    --silent --write-out "HTTP_STATUS:%{http_code}")

  body=$(echo "$response" | sed -e 's/HTTP_STATUS:.*//g')
  status=$(echo "$response" | sed -n -e 's/^.*HTTP_STATUS://p')

  echo "$body" | jq .

  if [[ $status -eq 200 ]]; then
    echo "GET /tags succeeded: HTTP 200"
  else
    echo "GET /tags failed: HTTP $status"
    exit 1
  fi
}

# Function to test POST /tags
test_add_tag() {
  local name=$1
  local color=$2

  echo "Testing POST /tags with name: $name, color: $color..."
  response=$(curl -X POST "$API_URL" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"$name\", \"color\": \"$color\"}" \
    --silent --write-out "HTTP_STATUS:%{http_code}")

  body=$(echo "$response" | sed -e 's/HTTP_STATUS:.*//g')
  status=$(echo "$response" | sed -n -e 's/^.*HTTP_STATUS://p')

  echo "$body" | jq .

  if [[ $status -eq 201 ]]; then
    echo "POST /tags succeeded: Tag created successfully."
  elif [[ $status -eq 409 ]]; then
    error_message=$(echo "$body" | jq -r '.error')
    if [[ $error_message == "Tag already exists" ]]; then
      echo "POST /tags failed as expected: Tag already exists (HTTP 409)."
    else
      echo "Unexpected error message: $error_message"
      exit 1
    fi
  else
    echo "POST /tags failed: HTTP $status"
    exit 1
  fi
}

# Main script execution
echo "Starting Tag API Tests..."

# Clean up MongoDB collection
cleanup_mongodb

# Test POST /tags with valid data
test_add_tag "example-tag" "#FF5733"

# Test GET /tags
test_get_tags

# Test POST /tags with duplicate data
test_add_tag "example-tag" "#FF5733"

echo "Tests Completed."