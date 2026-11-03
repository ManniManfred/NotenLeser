<?php

declare(strict_types=1);

namespace OCA\NotenLeser\Controller;

use OCA\NotenLeser\AppInfo\Application;
use OCA\NotenLeser\Service\SettingsService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

class SettingsController extends Controller {
	public function __construct(
		IRequest $request,
		private SettingsService $settings,
		private ?string $userId,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	public function get(): JSONResponse {
		return new JSONResponse($this->settings->get((string)$this->userId));
	}

	#[NoAdminRequired]
	public function set(array $settings = []): JSONResponse {
		return new JSONResponse($this->settings->set((string)$this->userId, $settings));
	}
}
