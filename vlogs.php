<?php

session_start();

 if (isset($_SESSION['unique_id'])) {
    //  echo $_SESSION['unique_id'];
 } else {
     echo "No unique ID found in session";
 }
header("Access-Control-Allow-Origin: https://websocket-server-blqp.onrender.com");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("Access-Control-Allow-Credentials: true");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit();
}

error_reporting(E_ALL);
ini_set('display_errors', 1);
include 'database.php';
 
// Check connection
if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}

// Function to get user data
function get_user_data($conn, $unique_id) {
    $user_query = "SELECT unique_id, loyalty_discount, engagement, total_purchases, last_watch_date, total_watch_time FROM learners WHERE unique_id = ?";
    $stmt = $conn->prepare($user_query);
    $stmt->bind_param("s", $unique_id);
    $stmt->execute();
    $user_result = $stmt->get_result();
    return $user_result->fetch_assoc();
}

// Function to get video data for each video ID
function get_video_data($conn, $video_id) {
    $video_query = "SELECT id, base_price, video_currency, likes, shares, rating, video_duration, release_date FROM videos WHERE id = ?";
    $stmt = $conn->prepare($video_query);
    $stmt->bind_param("i", $video_id);
    $stmt->execute();
    $video_result = $stmt->get_result();
    return $video_result->fetch_assoc();
}

// Function to count user's occurrences in the wallets table
function count_user_wallet_entries($conn, $unique_id) {
    $count_query = "SELECT COUNT(*) as count FROM wallets WHERE unique_id = ?";
    $stmt = $conn->prepare($count_query);
    $stmt->bind_param("s", $unique_id);
    $stmt->execute();
    $result = $stmt->get_result()->fetch_assoc();
    return $result['count'];
}

// Function to get holidays from the database
function get_holidays($conn) {
    $holiday_query = "SELECT holiday_date FROM holidays";
    $result = $conn->query($holiday_query);
    $holidays = [];
    while ($row = $result->fetch_assoc()) {
        $holidays[] = $row['holiday_date'];
    }
    return $holidays;
}

// Function to check if the release date is a holiday
function is_holiday($release_date, $holidays) {
    return in_array($release_date, $holidays);
}

// Function to calculate final price based on rules
function calculate_final_price($user_data, $video_data, $funding_frequency, $holidays) {
    $video_base_price = $video_data['base_price'];
    $price_after_loyalty = $video_base_price - $user_data['loyalty_discount'];

    if ($user_data['engagement'] < 10) {
        $price_after_loyalty *= ($video_data['video_currency'] === 'NGN') ? 0.7 : 0.8;
    }

    if ($user_data['total_purchases'] <= 100) {
    } elseif ($user_data['total_purchases'] <= 500) {
        $price_after_loyalty *= 1.1;
    } else {
        $extra_markup = floor(($user_data['total_purchases'] - 500) / 500) * 0.02;
        $price_after_loyalty *= (1 + $extra_markup);
    }

    $last_watch_date = $user_data['last_watch_date'] ?? '';
    $last_watch_time = !empty($last_watch_date) ? strtotime($last_watch_date) : 0;
    
    if ($last_watch_time && $last_watch_time >= strtotime('-1 week')) {
        $price_after_loyalty *= 0.95;
    } else {
        $price_after_loyalty *= 0.93;
    }

    if ($user_data['total_watch_time'] <= 10000) {
        $price_after_loyalty *= 1.1;
    } else {
        $price_after_loyalty *= 1.13;
    }

    if ($video_data['likes'] > 100) {
        $price_after_loyalty *= 1.05;
    }

    if ($video_data['shares'] > 100) {
        $price_after_loyalty *= 1.03;
    }

    if ($video_data['rating'] > 2.5) {
        $price_after_loyalty *= 1.01;
    }

    if ($video_data['video_duration'] > 60) {
        $price_after_loyalty *= (1 + 0.0005 * (floor($video_data['video_duration'] / 60)));
    }

    if (is_holiday($video_data['release_date'], $holidays)) {
        $price_after_loyalty *= 0.6;
    }

    if ($funding_frequency < 10) {
        $price_after_loyalty *= 0.9;
    } else {
        $price_after_loyalty *= 1.01;
    }

    return max($price_after_loyalty, 0);
}

// Main logic to get final prices for multiple videos
function get_videos_final_price($conn, $unique_id, $video_ids) {
    $user_data = get_user_data($conn, $unique_id);
    $funding_frequency = count_user_wallet_entries($conn, $unique_id);
    $holidays = get_holidays($conn);
    $final_prices = [];

    foreach ($video_ids as $video_id) {
        $video_data = get_video_data($conn, $video_id);

        if ($user_data && $video_data) {
            $final_price = calculate_final_price($user_data, $video_data, $funding_frequency, $holidays);
            $final_prices[$video_id] = [
                'final_price' => number_format($final_price, 2),
                'currency' => $video_data['video_currency']
            ];
        } else {
            $final_prices[$video_id] = [
                'success' => false,
                'message' => 'User or video not found.'
            ];
        }
    }

    return $final_prices;
}

$page = isset($_GET['page']) ? (int)$_GET['page'] : 1;
$limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 9;
$offset = ($page - 1) * $limit;
$search = isset($_GET['search']) ? trim($_GET['search']) : null;

$response = array();
$response['videos'] = array();

if ($search) {
    $search = "%{$search}%";
    $countQuery = "SELECT COUNT(*) as total FROM videos WHERE title LIKE ? OR category LIKE ? OR tags LIKE ? OR creator_name LIKE ? OR base_price LIKE ?";
    $videoQuery = "SELECT *
                   FROM videos 
                   WHERE title LIKE ? OR category LIKE ? OR tags LIKE ? OR creator_name LIKE ? OR base_price LIKE ?
                   ORDER BY release_date DESC
                   LIMIT ? OFFSET ?";
    $countStmt = $conn->prepare($countQuery);
    $countStmt->bind_param("sssss", $search, $search, $search, $search, $search);
    $videoStmt = $conn->prepare($videoQuery);
    $videoStmt->bind_param("sssssii", $search, $search, $search, $search, $search, $limit, $offset);
} else {
    $countQuery = "SELECT COUNT(*) as total FROM videos";
    $videoQuery = "SELECT *
                   FROM videos 
                   ORDER BY release_date DESC
                   LIMIT ? OFFSET ?";
    $countStmt = $conn->prepare($countQuery);
    $videoStmt = $conn->prepare($videoQuery);
    $videoStmt->bind_param("ii", $limit, $offset);
}

// Execute Count Query
$countStmt->execute();
$totalResult = $countStmt->get_result();
$totalRow = $totalResult->fetch_assoc();
$total = $totalRow['total'] ?? 0;

// Execute Video Query
$videoStmt->execute();
$result = $videoStmt->get_result();

$video_ids = array();
while ($row = $result->fetch_assoc()) {
    $video_ids[] = $row["id"];
}

// Fetch Video Details and Calculate Prices
if (isset($_SESSION['unique_id']) && !empty($video_ids)) {
    $results = get_videos_final_price($conn, $_SESSION['unique_id'], $video_ids);
}

if ($result->num_rows > 0) {
    $result->data_seek(0);
    while ($row = $result->fetch_assoc()) {
        $video = array(
            'id' => $row['id'],
            'title' => $row['title'],
            'creator_name' => $row['creator_name'],
            'creator_id' => $row['creator_id'],
            'avatar' => pickAvatar($row['creator_id']),
            'video_file' => $row['video_file'],
            'views' => number_format($row['views']),
            'video_duration' => formatDuration($row['video_duration']),
            'time_elapsed' => time_elapsed_string($row['release_date']),
            'category' => $row['category'],
            'tags' => $row['tags'],
            'shares' => number_format($row['shares']),
            'likes' => number_format($row['likes']),
            'rating' => $row['rating'],
            'thumbnail' => $row['thumbnail'],
            'description'=> $row['description'],
            'release_date' => $row['release_date'],
            'created_at' => $row['created_at'],
            'comments' => getComments($row['id'])
        );

        if (isset($results[$row["id"]])) {
            $video['price'] = array(
                'amount' => $results[$row["id"]]['final_price'],
                'currency' => $results[$row["id"]]['currency']
            );
        }

        $response['videos'][] = $video;
    }

    $response['pagination'] = array(
        'current_page' => $page,
        'total_pages' => ceil($total / $limit),
        'limit' => $limit,
        'total_records' => $total
    );
} else {
    $response['videos'] = [];
    $response['message'] = $search ? "We can't get a video for your search query" : "No videos found";
}

$conn->close();

echo json_encode($response);


function time_elapsed_string($datetime, $full = false) {
    $now = new DateTime;
    $ago = new DateTime($datetime);
    $diff = $now->diff($ago);

    $weeks = floor($diff->d / 7);
    $diff->d -= $weeks * 7;

    $string = array(
        'y' => 'year',
        'm' => 'month',
        'w' => 'week',
        'd' => 'day',
        'h' => 'hour',
        'i' => 'minute',
        's' => 'second',
    );
    foreach ($string as $k => &$v) {
        $value = ($k === 'w') ? $weeks : $diff->$k;
        if ($value) {
            $v = $value . ' ' . $v . ($value > 1 ? 's' : '');
        } else {
            unset($string[$k]);
        }
    }

    if (!$full) $string = array_slice($string, 0, 1);
    return $string ? implode(', ', $string) . ' ago' : 'just now';
}
function formatDuration($seconds) {
    if ($seconds < 60) {
        return "$seconds seconds";
    }
    
    $days = floor($seconds / 86400);
    $hours = floor(($seconds % 86400) / 3600);
    $minutes = floor(($seconds % 3600) / 60);
    $secs = $seconds % 60;
    
    $format = [];
    if ($days > 0) {
        $format[] = "$days days";
    }
    if ($hours > 0) {
        $format[] = "$hours hours";
    }
    if ($minutes > 0) {
        $format[] = "$minutes minutes";
    }
    if ($secs > 0) {
        $format[] = "$secs seconds";
    }
    
    return implode(", ", $format);
}




function pickAvatar($creator_id) {
    global $conn;
    $sql = "SELECT avatar FROM educators WHERE unique_id = ?";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param("s", $creator_id);
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($row = $result->fetch_assoc()) {
        return $row['avatar'];
    }
    return 'default.png'; // Return default avatar if none found
}


function getTimestamps($video_id) {
    global $conn;
    $sql = "SELECT id, video_id, timestamp, description, creator_id FROM timestamps WHERE video_id = ?";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param("s", $video_id);
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($result) {
        return $result->fetch_all(MYSQLI_ASSOC);
    }
    return []; // Return empty array if no timestamps found
}

function getComments($video_id) {
            global $conn;
            $sql = "SELECT c.id, c.video_id, c.unique_id, c.username, c.content, c.timestamp, c.comment_likes,
                    r.id as response_id, r.content as response_content, r.timestamp as response_timestamp, r.unique_id as response_unique_id,
                    r.username as response_username, r.likes as response_likes, l.avatar, rl.avatar as response_avatar
                    FROM video_comments c 
                    LEFT JOIN learners l ON c.unique_id = l.unique_id 
                    LEFT JOIN comment_responses r ON c.id = r.comment_id
                    LEFT JOIN learners rl ON r.unique_id = rl.unique_id
                    WHERE c.video_id = ?";
            $stmt = $conn->prepare($sql);
            $stmt->bind_param("s", $video_id);
            $stmt->execute();
            $result = $stmt->get_result();
      
            $comments = array();
            if ($result) {
                $current_comment = null;
                while ($row = $result->fetch_assoc()) {
                    if (!isset($comments[$row['id']])) {
                        $comments[$row['id']] = array(
                            'id' => $row['id'],
                            'video_id' => $row['video_id'],
                            'unique_id' => $row['unique_id'],
                            'username' => $row['username'],
                            'content' => $row['content'],
                            'timestamp' => $row['timestamp'],
                            'comment_likes' => $row['comment_likes'],
                            'comment_responses' => array(),
                            'avatar' => $row['avatar'] ?? 'default.png'
                        );
                    }
                  
                    if ($row['response_id']) {
                        $comments[$row['id']]['comment_responses'][] = array(
                            'id' => $row['response_id'],
                            'content' => $row['response_content'],
                            'timestamp' => $row['response_timestamp'],
                            'unique_id' => $row['response_unique_id'],
                            'username' => $row['response_username'],
                            'likes' => $row['response_likes'],
                            'avatar' => $row['response_avatar'] ?? 'default.png'
                        );
                    }
                }
                return array_values($comments);
            }
            
                
                function getVideoRating($video_id) {
                    global $conn;
                    $sql = "SELECT v.id, v.video_id, v.unique_id, v.rating, v.timestamp,
                            AVG(rating) as average_rating,
                            COUNT(rating) as total_ratings
                            FROM videoratings v 
                            WHERE v.video_id = ?
                            GROUP BY v.video_id";
                    $stmt = $conn->prepare($sql);
                    $stmt->bind_param("s", $video_id);
                    $stmt->execute();
                    $result = $stmt->get_result();
          
                    if ($result && $row = $result->fetch_assoc()) {
                        return array(
                            'id' => $row['id'],
                            'video_id' => $row['video_id'],
                            'unique_id' => $row['unique_id'],
                            'rating' => $row['rating'],
                            'timestamp' => $row['timestamp'],
                            'average_rating' => $row['average_rating'],
                            'total_ratings' => $row['total_ratings']
                        );
                    }
                    return null;
                }
            return []; // Return empty array if no timestamps found
            
             function getRelatedVideo($video_id) {
                    global $conn;
                    $sql = "SELECT id, video_file, title, thumbnail, video_duration, views, release_date 
                        FROM videos 
                        WHERE category = (SELECT category FROM videos WHERE id = ?) 
                        AND id != ? 
                        ORDER BY release_date DESC 
                        LIMIT 5";
                    $stmt = $conn->prepare($sql);
                    $stmt->bind_param("ii", $video_id, $video_id);
                    $stmt->execute();
                    $result = $stmt->get_result();

                    $related_videos = [];
                    if ($result) {
                        while ($row = $result->fetch_assoc()) {
                        $related_videos[] = array(
                            'id' => $row['id'],
                            'title' => $row['title'],
                            'thumbnail' => $row['thumbnail'],
                            'video_duration' => formatDuration($row['video_duration']),
                            'views' => number_format($row['views']),
                            'release_date' => time_elapsed_string($row['release_date'])
                        );
                        }
                    }
                    return $related_videos;
                }
            
        }
        
        
        
        