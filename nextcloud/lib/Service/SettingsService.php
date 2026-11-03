<?php

declare(strict_types=1);

namespace OCA\NotenLeser\Service;

use OCA\NotenLeser\AppInfo\Application;
use OCP\IConfig;

/** Per-user reader settings, stored as user preferences so they follow the user to every device. */
class SettingsService {
	/** Setting name => [type, default, allowed values or null]. */
	private const SCHEMA = [
		'voice' => ['int', 0, [0, 1, 2, 3, 4, 5, 6]],
		'twoSystemsMinimum' => ['bool', false, null],
		'cameraGestures' => ['bool', false, null],
		'cameraSensitivity' => ['int', 0, [0, 1, 2]],
		'cameraDebug' => ['bool', false, null],
		'playbackSpeed' => ['int', 100, [50, 75, 100, 125]],
		'lastFile' => ['string', '', null],
		'lastFolder' => ['string', '', null],
	];

	public function __construct(
		private IConfig $config,
	) {
	}

	public function get(string $userId): array {
		$result = [];
		foreach (self::SCHEMA as $key => [$type, $default]) {
			$raw = $userId === '' ? null : $this->config->getUserValue($userId, Application::APP_ID, $key, '');
			$result[$key] = $raw === null || $raw === '' ? $default : $this->convert($type, $raw);
		}
		return $result;
	}

	public function set(string $userId, array $values): array {
		if ($userId !== '') {
			foreach ($values as $key => $value) {
				if (!isset(self::SCHEMA[$key])) {
					continue;
				}
				[$type, , $allowed] = self::SCHEMA[$key];
				$value = $this->convert($type, $value);
				if ($allowed !== null && !in_array($value, $allowed, true)) {
					continue;
				}
				if ($type === 'string' && strlen($value) > 4000) {
					continue;
				}
				$stored = $type === 'bool' ? ($value ? '1' : '0') : (string)$value;
				$this->config->setUserValue($userId, Application::APP_ID, $key, $stored);
			}
		}
		return $this->get($userId);
	}

	private function convert(string $type, mixed $value): int|bool|string {
		return match ($type) {
			'int' => (int)$value,
			'bool' => $value === true || $value === 1 || $value === '1' || $value === 'true',
			default => (string)$value,
		};
	}
}
