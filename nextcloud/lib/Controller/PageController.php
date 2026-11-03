<?php

declare(strict_types=1);

namespace OCA\NotenLeser\Controller;

use OCA\NotenLeser\AppInfo\Application;
use OCA\NotenLeser\Service\SettingsService;
use OCP\App\IAppManager;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\FeaturePolicy;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\Util;

class PageController extends Controller {
	public function __construct(
		IRequest $request,
		private IInitialState $initialState,
		private SettingsService $settings,
		private IAppManager $appManager,
		private IURLGenerator $urlGenerator,
		private ?string $userId,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/** The reader inside the normal Nextcloud page. */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function index(): TemplateResponse {
		return $this->page(false);
	}

	/** The reader filling the whole screen without the Nextcloud header (e.g. on iPhones, which have no fullscreen mode). */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function reader(): TemplateResponse {
		return $this->page(true);
	}

	/** Lets browsers add the header-less reader to the home screen as a fullscreen app. */
	#[PublicPage]
	#[NoCSRFRequired]
	public function manifest(): JSONResponse {
		$icon = fn (string $file, string $size) => [
			'src' => $this->urlGenerator->imagePath(Application::APP_ID, $file),
			'sizes' => $size,
			'type' => 'image/png',
			'purpose' => 'any',
		];
		$response = new JSONResponse([
			'name' => 'NotenLeser',
			'short_name' => 'NotenLeser',
			'description' => 'Noten im Vollbild lesen',
			'start_url' => $this->urlGenerator->linkToRoute('notenleser.page.reader'),
			'scope' => $this->urlGenerator->linkToRoute('notenleser.page.index'),
			'display' => 'fullscreen',
			'display_override' => ['fullscreen', 'standalone'],
			'orientation' => 'any',
			'background_color' => '#14181d',
			'theme_color' => '#14181d',
			'icons' => [$icon('icon-192.png', '192x192'), $icon('icon-512.png', '512x512')],
		]);
		$response->addHeader('Content-Type', 'application/manifest+json; charset=utf-8');
		$response->cacheFor(3600);
		return $response;
	}

	private function page(bool $bare): TemplateResponse {
		$this->initialState->provideInitialState('settings', $this->settings->get((string)$this->userId));
		$this->initialState->provideInitialState('version', $this->appManager->getAppVersion(Application::APP_ID));
		$this->initialState->provideInitialState('bare', $bare);
		Util::addStyle(Application::APP_ID, 'notenleser');
		if ($bare) {
			Util::addStyle(Application::APP_ID, 'notenleser-bare');
		}
		Util::addScript(Application::APP_ID, 'notenleser-main');
		// Home screen support: our manifest plus Apple's own tags for iPhone and iPad.
		Util::addHeader('link', ['rel' => 'manifest', 'href' => $this->urlGenerator->linkToRoute('notenleser.page.manifest')]);
		Util::addHeader('link', ['rel' => 'apple-touch-icon', 'href' => $this->urlGenerator->imagePath(Application::APP_ID, 'icon-180.png')]);
		Util::addHeader('meta', ['name' => 'apple-mobile-web-app-capable', 'content' => 'yes']);
		Util::addHeader('meta', ['name' => 'mobile-web-app-capable', 'content' => 'yes']);
		Util::addHeader('meta', ['name' => 'apple-mobile-web-app-status-bar-style', 'content' => 'black-translucent']);
		Util::addHeader('meta', ['name' => 'apple-mobile-web-app-title', 'content' => 'NotenLeser']);

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
