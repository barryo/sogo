﻿/*
Copyright (c) 2003-2009, CKSource - Frederico Knabben. All rights reserved.
For licensing, see LICENSE.html or http://ckeditor.com/license
*/

/**
 * @fileOverview Spell Check As You Type (SCAYT).
 * Button name : Scayt.
 */

(function()
{
	var commandName 	= 'scaytcheck',
		sc_on_cssclass 	= 'scayt_enabled',
		sc_off_cssclass = 'scayt_disabled',
		openPage		= '';

	var onEngineLoad = function()
	{
		var editor = this;
		dojo.requireLocalization( 'scayt', 'caption', '', 'ROOT' );

		var createInstance = function()	// Create new instance every time Document is created.
		{
			// Initialise Scayt instance.
			var oParams = CKEDITOR.config.scaytParams || {};
			oParams.srcNodeRef = editor.document.getWindow().$.frameElement; 		// Get the iframe.
			// syntax : AppName.AppVersion@AppRevision
			oParams.assocApp  = "CKEDITOR." + CKEDITOR.version + "@" + CKEDITOR.revision;
			var scayt_control = new scayt( oParams );

			// Copy config.
			var	lastInstance = plugin.instances[ editor.name ];
			if ( lastInstance )
			{
				scayt_control.sLang = lastInstance.sLang;
				scayt_control.option( lastInstance.option() );
				scayt_control.paused = lastInstance.paused;
			}

			plugin.instances[ editor.name ] = scayt_control;

			try {
				scayt_control.setDisabled( scayt_control.paused === false );				// I really don't know why it causes JS error in IE
			} catch (e) {}
			editor.fire( 'showScaytState' );
		};

		editor.on( 'contentDom', createInstance );
		editor.on( 'contentDomUnload', function()
			{
				// Remove scripts.
				var scripts = CKEDITOR.document.getElementsByTag( 'script' ),
					scaytIdRegex =  /^dojoIoScript(\d+)$/i,
					scaytSrcRegex =  /^https?:\/\/svc\.spellchecker\.net\/spellcheck\/script\/ssrv\.cgi/i;

				for ( var i=0; i < scripts.count(); i++ )
				{
					var script = scripts.getItem( i ),
						id = script.getId(),
						src = script.getAttribute( 'src' );

					if ( id && src && id.match( scaytIdRegex ) && src.match( scaytSrcRegex ))
						script.remove();
				}
			});

		editor.on( 'beforeCommandExec', function( ev )		// Disable SCAYT before Source command execution.
			{
				if ( ev.data.name == 'source' && editor.mode == 'wysiwyg' )
				{
					var scayt = plugin.getScayt( editor );
					if ( scayt )
					{
						scayt.paused = !scayt.disabled;
						scayt.setDisabled( true );
					}
				}
			});

		// Listen to data manipulation to reflect scayt markup.
		editor.on( 'afterSetData', function()
			{
				if ( plugin.isScaytEnabled( editor ) )
					plugin.getScayt( editor ).refresh();
			});

		editor.on( 'scaytDialog', function( ev )	// Communication with dialog.
			{
				ev.data.djConfig = djConfig;
				ev.data.scayt_control = plugin.getScayt( editor );
				ev.data.tab = openPage;
				ev.data.scayt = scayt;
			});

		var dataProcessor = editor.dataProcessor,
			htmlFilter = dataProcessor && dataProcessor.htmlFilter;
		if ( htmlFilter )
		{
			htmlFilter.addRules(
				{
					elements :
					{
						span : function( element )
						{
							if ( element.attributes.scayt_word && element.attributes.scaytid )
							{
								delete element.name;	// Write children, but don't write this node.
								return element;
							}
						}
					}
				}
			);
		}

		if ( editor.document )
			createInstance();
	};

	CKEDITOR.plugins.scayt =
	{
		engineLoaded : false,
		instances : {},
		getScayt : function( editor )
		{
			var instance = this.instances[ editor.name ];
			return instance;
		},
		isScaytReady : function( editor )
		{
			return this.engineLoaded === true &&
				'undefined' !== typeof scayt && this.getScayt( editor );
		},
		isScaytEnabled : function( editor )
		{
			var scayt = this.getScayt( editor );
			return ( scayt ) ? scayt.disabled === false : false;
		},
		loadEngine : function( editor )
		{
			if ( this.engineLoaded === true )
				return onEngineLoad.apply( editor );	// Add new instance.
			else if ( this.engineLoaded == -1 )			// We are waiting.
				return CKEDITOR.on( 'scaytReady', function(){ onEngineLoad.apply( editor );} );	// Use function(){} to avoid rejection as duplicate.

			CKEDITOR.on( 'scaytReady', onEngineLoad, editor );
			CKEDITOR.on( 'scaytReady', function()
				{
					this.engineLoaded = true;
				},
				this,
				null,
				0 );	// First to run.

			this.engineLoaded = -1;	// Loading in progress.
			// assign diojo configurable vars
			var parseUrl =  function(data)
				{
					var m = data.match(/(.*)[\/\\]([^\/\\]+\.\w+)$/);
					return { path: m[1], file: m[2] };
				};

			// compose scayt url
			var protocol = document.location.protocol;
			var baseUrl  = "svc.spellchecker.net/spellcheck/lf/scayt/scayt.js";
			var scaytUrl  =  editor.config.scaytParams.srcScayt ||
				(protocol + "//" + baseUrl);
			var scaytConfigBaseUrl = parseUrl(scaytUrl).path +  "/";

			djScaytConfig =
			{
				baseUrl: scaytConfigBaseUrl,
				addOnLoad:
				[
					function()
					{
						CKEDITOR.fireOnce( "scaytReady" );
					}
				],
				isDebug: false
			};
			// Append javascript code.
			CKEDITOR.document.getHead().append(
				CKEDITOR.document.createElement( 'script',
					{
						attributes :
							{
								type : 'text/javascript',
								src : scaytUrl
							}
					})
			);

			return null;
		}
	};

	var plugin = CKEDITOR.plugins.scayt;

	// Context menu constructing.
	var addButtonCommand = function( editor, buttonName, buttonLabel, commandName, command, menugroup, menuOrder )
	{
		editor.addCommand( commandName, command );

		// If the "menu" plugin is loaded, register the menu item.
		editor.addMenuItem( commandName,
			{
				label : buttonLabel,
				command : commandName,
				group : menugroup,
				order : menuOrder
			});
	};

	var commandDefinition =
	{
		preserveState : true,

		exec: function( editor )
		{
			if ( plugin.isScaytReady( editor ) )
			{
				var isEnabled = plugin.isScaytEnabled( editor );

				this.setState( isEnabled ? CKEDITOR.TRISTATE_OFF : CKEDITOR.TRISTATE_ON );

				var scayt_control = plugin.getScayt( editor );
				scayt_control.setDisabled( isEnabled );
			}
			else if ( !editor.config.scayt_autoStartup && plugin.engineLoaded >= 0 )	// Load first time
			{
				this.setState( CKEDITOR.TRISTATE_DISABLED );

				editor.on( 'showScaytState', function()
					{
						this.removeListener();
						this.setState( plugin.isScaytEnabled( editor ) ? CKEDITOR.TRISTATE_ON : CKEDITOR.TRISTATE_OFF );
					},
					this);

				plugin.loadEngine( editor );
			}
		}
	};

	// Add scayt plugin.
	CKEDITOR.plugins.add( 'scayt',
	{
		requires : [ 'menubutton' ],

		beforeInit : function( editor )
		{
			// Register own rbc menu group.
			editor.config.menu_groups = 'scayt_suggest,scayt_moresuggest,scayt_control,' + editor.config.menu_groups;
		},

		init : function( editor )
		{
			var moreSuggestions = {};
			var mainSuggestions = {};

			// Scayt command.
			var command = editor.addCommand( commandName, commandDefinition );

			// Add Options dialog.
			CKEDITOR.dialog.add( commandName, CKEDITOR.getUrl( this.path + 'dialogs/options.js' ) );

			var menuGroup = 'scaytButton';
			editor.addMenuGroup( menuGroup );
			editor.addMenuItems(
				{
					scaytToggle :
					{
						label : editor.lang.scayt.enable,
						command : commandName,
						group : menuGroup
					},

					scaytOptions :
					{
						label : editor.lang.scayt.options,
						group : menuGroup,
						onClick : function()
						{
							openPage = 'options';
							editor.openDialog( commandName );
						}
					},

					scaytLangs :
					{
						label : editor.lang.scayt.langs,
						group : menuGroup,
						onClick : function()
						{
							openPage = 'langs';
							editor.openDialog( commandName );
						}
					},

					scaytAbout :
					{
						label : editor.lang.scayt.about,
						group : menuGroup,
						onClick : function()
						{
							openPage = 'about';
							editor.openDialog( commandName );
						}
					}
				});

			// Disabling it on IE for now, as it's blocking the browser (#3802).
			if ( !CKEDITOR.env.ie )
			{
				editor.ui.add( 'Scayt', CKEDITOR.UI_MENUBUTTON,
					{
						label : editor.lang.scayt.title,
						title : editor.lang.scayt.title,
						className : 'cke_button_scayt',
						onRender: function()
						{
							command.on( 'state', function()
								{
									this.setState( command.state );
								},
								this);
						},
						onMenu : function()
						{
							var isEnabled = plugin.isScaytEnabled( editor );

							editor.getMenuItem( 'scaytToggle' ).label = editor.lang.scayt[ isEnabled ? 'disable' : 'enable' ];

							return {
								scaytToggle : CKEDITOR.TRISTATE_OFF,
								scaytOptions : isEnabled ? CKEDITOR.TRISTATE_OFF : CKEDITOR.TRISTATE_DISABLED,
								scaytLangs : isEnabled ? CKEDITOR.TRISTATE_OFF : CKEDITOR.TRISTATE_DISABLED,
								scaytAbout : isEnabled ? CKEDITOR.TRISTATE_OFF : CKEDITOR.TRISTATE_DISABLED
							};
						}
					});
			}

			// If the "contextmenu" plugin is loaded, register the listeners.
			if ( editor.contextMenu && editor.addMenuItems )
			{
				editor.contextMenu.addListener( function( element, selection )
					{
						var scayt_control = plugin.getScayt( editor );
						if ( !plugin.isScaytEnabled( editor ) || !element || !element.$ )
							return null;

						var word = scayt_control.getWord( element.$ );

						if ( !word )
							return null;

						var sLang = scayt_control.getLang(),
							_r = {},
							items_suggestion = scayt.getSuggestion( word, sLang );
						if (!items_suggestion || !items_suggestion.length )
							return null;
						// Remove unused commands and menuitems
						for ( i in moreSuggestions )
						{
							delete editor._.menuItems[ i ];
							delete editor._.commands[ i ];
						}
						for ( i in mainSuggestions )
						{
							delete editor._.menuItems[ i ];
							delete editor._.commands[ i ];
						}
						moreSuggestions = {};		// Reset items.
						mainSuggestions = {};

						var moreSuggestionsUnable = false;

						for ( var i = 0, l = items_suggestion.length; i < l; i += 1 )
						{
							var commandName = 'scayt_suggestion_' + items_suggestion[i].replace( ' ', '_' );
							var exec = ( function( el, s )
								{
									return {
										exec: function( editor )
										{
											scayt_control.replace(el, s);
										}
									};
								})( element.$, items_suggestion[i] );

							if ( i < editor.config.scayt_maxSuggestions )
							{
								addButtonCommand( editor, 'button_' + commandName, items_suggestion[i],
									commandName, exec, 'scayt_suggest', i + 1 );
								_r[ commandName ] = CKEDITOR.TRISTATE_OFF;
								mainSuggestions[ commandName ] = CKEDITOR.TRISTATE_OFF;
							}
							else
							{
								addButtonCommand( editor, 'button_' + commandName, items_suggestion[i],
									commandName, exec, 'scayt_moresuggest', i + 1 );
								moreSuggestions[ commandName ] = CKEDITOR.TRISTATE_OFF;
								moreSuggestionsUnable = true;
							}
						}
						if ( moreSuggestionsUnable )
							// Rgister the More suggestions group;
							editor.addMenuItem( 'scayt_moresuggest',
								{
									label : editor.lang.scayt.moreSuggestions,
									group : 'scayt_moresuggest',
									order : 10,
									getItems : function()
									{
										return moreSuggestions;
									}
								});


						var ignore_command =
						{
							exec: function()
							{
								scayt_control.ignore( element.$ );
							}
						};
						var ignore_all_command =
						{
							exec: function()
							{
								scayt_control.ignoreAll( element.$ );
							}
						};
						var addword_command =
						{
							exec: function()
							{
								scayt.addWordToUserDictionary( element.$ );
							}
						};

						addButtonCommand( editor, 'ignore', editor.lang.scayt.ignore,
							'scayt_ignore', ignore_command, 'scayt_control', 1);
						addButtonCommand( editor, 'ignore_all', editor.lang.scayt.ignoreAll,
							'scayt_ignore_all', ignore_all_command, 'scayt_control', 2);
						addButtonCommand( editor, 'add_word', editor.lang.scayt.addWord,
							'scayt_add_word', addword_command, 'scayt_control', 3);

						mainSuggestions[ 'scayt_moresuggest' ] = CKEDITOR.TRISTATE_OFF;
						mainSuggestions[ 'scayt_ignore' ] = CKEDITOR.TRISTATE_OFF;
						mainSuggestions[ 'scayt_ignore_all' ] = CKEDITOR.TRISTATE_OFF;
						mainSuggestions[ 'scayt_add_word' ] = CKEDITOR.TRISTATE_OFF;

						// ** ahow ads entry point
						// ** hide ads listener register
//						try{
							//scayt_control.showBanner( editor )
//						}catch(err){}

						return mainSuggestions;
					});
			}

			// Start plugin
			if ( editor.config.scayt_autoStartup )
			{
				var showInitialState = function()
				{
					editor.removeListener( 'showScaytState', showInitialState );
					command.setState( plugin.isScaytEnabled( editor ) ? CKEDITOR.TRISTATE_ON : CKEDITOR.TRISTATE_OFF );
				};
				editor.on( 'showScaytState', showInitialState );

				plugin.loadEngine( editor );
			}
		}
	});
})();

CKEDITOR.config.scaytParams = CKEDITOR.config.scaytParams || {};
CKEDITOR.config.scayt_maxSuggestions = 5;
CKEDITOR.config.scayt_autoStartup = false;