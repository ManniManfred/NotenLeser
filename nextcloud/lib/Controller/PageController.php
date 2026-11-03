<?php

declare(strict_types=1);

namespace OCA\NotenLeser\Controller;

use OCA\NotenLeser\AppInfo\Application;
use OCA\NotenLeser\Service\SettingsService;
use OCP\App\IAppManager;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\FeaturePolicy;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\IRequest;
use OCP\Util;

class PageController extends Controller {
	public function __construct(
		IRequest $request,
		private IInitialState $initialState,
		private SettingsService $settings,
		private IAppManager $appManager,
		private ?string $userId,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function index(): TemplateResponse {
		$this->initialState->provideInitialState('settings', $this->settings->get((string)$this->userId));
		$this->initialState->provideInitialState('version', $this->appManager->getAppVersion(Application::APP_ID));
		Util::addStyle(Application::APP_ID, 'notenleser');
		Util::addScript(Application::APP_ID, 'notenleser-main');

		$response = new TemplateResponse(Application::APP_ID, 'main');
		$csp = new ContentSecurityPolicy();
		// pdf.js renders in a module worker served from the app folder.
		$csp->addAllowedWorkerSrcDomain("'self'");
		$csp->addAllowedWorkerSrcDomain('blob:');
		$csp->addAllowedFontDomain("'self'");
		$csp->addAllowedFontDomain('data:');
		$csp->addAllowedMediaDomain('blob:');
		$response->setContentSecurityPolicy($csp);
		// The front camera is used for turning with a hand movement, the score can go fullscreen.
		$features = new FeaturePolicy();
		$features->addAllowedCameraDomain("'self'");
		$features->addAllowedFullScreenDomain("'self'");
		$response->setFeaturePolicy($features);
		return $response;
	}
}
