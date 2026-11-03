<?php

declare(strict_types=1);

return [
	'routes' => [
		['name' => 'page#index', 'url' => '/', 'verb' => 'GET'],
		// The reader without the Nextcloud header, for phones and the home screen.
		['name' => 'page#reader', 'url' => '/reader', 'verb' => 'GET'],
		['name' => 'page#manifest', 'url' => '/manifest.webmanifest', 'verb' => 'GET'],
		['name' => 'settings#get', 'url' => '/settings', 'verb' => 'GET'],
		['name' => 'settings#set', 'url' => '/settings', 'verb' => 'PUT'],
	],
];
