<?php
header('Content-Type: application/json');
error_reporting(E_ALL);
ini_set('display_errors', 1);

// Include database connection
include 'database.php';

// Check connectionkkmk

if ($conn->connect_error) {
    echo json_encode(["status" => "error", "message" => "Connection failed: " . $conn->connect_error]);
    exit;
}

// Prepare query
$sql = "SELECT * FROM webstreams";
$result = $conn->query($sql);

// If query fails
if (!$result) {
    echo json_encode(["status" => "error", "message" => "Query failed: " . $conn->error]);
    $conn->close();
    exit;
}

// Process rows
$webstreams = [];
while ($row = $result->fetch_assoc()) {
    $webstreams[] = $row;
}

// Final response
echo json_encode([
    'status' => 'success',
    'data' => $webstreams
]);

$conn->close();
