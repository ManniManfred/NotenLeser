<?php

declare(strict_types=1);

namespace OCA\NotenLeser\Listener;

use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCA\NotenLeser\AppInfo\Application;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Util;

/** @template-implements IEventListener<LoadAdditionalScriptsEvent> */
class LoadFilesScriptsListener implements IEventListener {
	public function handle(Event $event): void {
		if (!($event instanceof LoadAdditionalScriptsEvent)) {
			return;
		}
		Util::addInitScript(Application::APP_ID, 'notenleser-files');
	}
}
