/* SOGoSAML2Session.m - this file is part of SOGo
 *
 * Copyright (C) 2012 Inverse inc.
 *
 * Author: Wolfgang Sourdeau <wsourdeau@inverse.ca>
 *
 * This file is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2, or (at your option)
 * any later version.
 *
 * This file is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; see the file COPYING.  If not, write to
 * the Free Software Foundation, Inc., 59 Temple Place - Suite 330,
 * Boston, MA 02111-1307, USA.
 */

#include <lasso/lasso.h>
#include <lasso/xml/misc_text_node.h>
#include <lasso/xml/saml-2.0/saml2_attribute.h>
#include <lasso/xml/saml-2.0/saml2_attribute_statement.h>
#include <lasso/xml/saml-2.0/saml2_attribute_value.h>
#include <lasso/xml/saml-2.0/samlp2_authn_request.h>
#include <lasso/xml/saml-2.0/samlp2_response.h>

#import <Foundation/NSBundle.h>
#import <Foundation/NSDictionary.h>
#import <Foundation/NSException.h>
#import <Foundation/NSMapTable.h>
#import <Foundation/NSString.h>
#import <Foundation/NSURL.h>

#import <NGObjWeb/WOApplication.h>
#import <NGObjWeb/WORequest.h>
#import <NGObjWeb/WOContext.h>
#import <NGObjWeb/WOResponse.h>

#import "SOGoCache.h"
#import "SOGoSAML2Exceptions.h"
#import "SOGoSystemDefaults.h"

#import "SOGoSAML2Session.h"

@interface WOContext (SOGoSAML2Extension)

- (NSString *) SAML2ServerURLString;

@end

@implementation WOContext (SOGoSAML2Extension)

- (NSString *) SAML2ServerURLString
{
  NSString *appName;
  NSURL *serverURL;

  appName = [[WOApplication application] name];
  serverURL = [NSURL URLWithString: [NSString stringWithFormat: @"/%@",
                                              appName]
                     relativeToURL: [self serverURL]];

  return [serverURL absoluteString];
}

@end

@implementation SOGoSAML2Session

static NSMapTable *serverTable = nil;

+ (void) initialize
{
  if (!serverTable)
    {
      serverTable = [NSMapTable mapTableWithStrongToWeakObjects];
      [serverTable retain];
    }
  lasso_init ();
}

static LassoServer *
LassoServerInContext (WOContext *context)
{
  NSString *urlString, *metadata, *filename, *keyContent, *certContent,
    *idpKeyFilename, *idpCertFilename;
  LassoServer *server;
  SOGoSystemDefaults *sd;

  urlString = [context SAML2ServerURLString];
  server = NSMapGet (serverTable, urlString);
  if (!server)
    {
      sd = [SOGoSystemDefaults sharedSystemDefaults];

      filename = [sd SAML2PrivateKeyLocation];
      if (!filename)
        [NSException raise: NSInvalidArgumentException
                    format: @"'SAML2PrivateKeyLocation' not set"];
      keyContent = [NSString stringWithContentsOfFile: filename];
      if (!keyContent)
        [NSException raise: NSGenericException
                    format: @"private key file '%@' could not be read",
                     filename];

      filename = [sd SAML2CertificateLocation];
      if (!filename)
        [NSException raise: NSInvalidArgumentException
                    format: @"'SAML2CertificateLocation' not set"];
      certContent = [NSString stringWithContentsOfFile: filename];
      if (!certContent)
        [NSException raise: NSGenericException
                    format: @"certificate file '%@' could not be read",
                     filename];

      metadata = [SOGoSAML2Session metadataInContext: context];
      /* FIXME: enable key password in config ? */
      server = lasso_server_new_from_buffers ([metadata UTF8String],
                                              [keyContent UTF8String],
                                              NULL,
                                              [certContent UTF8String]);

      filename = [sd SAML2IdpMetadataLocation];
      idpKeyFilename = [sd SAML2IdpPublicKeyLocation];
      idpCertFilename = [sd SAML2IdpCertificateLocation];
      lasso_server_add_provider (server, LASSO_PROVIDER_ROLE_IDP,
                                 [filename UTF8String],
                                 [idpKeyFilename UTF8String],
                                 [idpCertFilename UTF8String]);
      NSMapInsert (serverTable, urlString, server);
    }

  return server;
}

+ (NSString *) authenticationURLInContext: (WOContext *) context
{
  lasso_error_t rc;
  LassoServer *server;
  LassoLogin *tempLogin;
  LassoSamlp2AuthnRequest *request;
  NSString *url;
  GList *providers;

  server = LassoServerInContext (context);
  tempLogin = lasso_login_new (server);

  providers = g_hash_table_get_keys (server->providers);
  rc = lasso_login_init_authn_request (tempLogin, providers->data, LASSO_HTTP_METHOD_REDIRECT);
  if (rc)
    [NSException raiseSAML2Exception: rc];

  request = LASSO_SAMLP2_AUTHN_REQUEST (LASSO_PROFILE (tempLogin)->request);
  if (request->NameIDPolicy->Format) {
    g_free (request->NameIDPolicy->Format);
  }
  request->NameIDPolicy->Format = g_strdup(LASSO_SAML2_NAME_IDENTIFIER_FORMAT_PERSISTENT);
  request->NameIDPolicy->AllowCreate = 1;
  request->ForceAuthn = TRUE;
  request->IsPassive = FALSE;
  if (request->ProtocolBinding) {
    g_free (request->ProtocolBinding);
  }
  // request->NameIDPolicy = strdup (LASSO_LIB_NAMEID_POLICY_TYPE_FEDERATED);
  // request->consent = strdup (LASSO_LIB_CONSENT_OBTAINED);
  rc = lasso_login_build_authn_request_msg (tempLogin);
  if (rc)
    [NSException raiseSAML2Exception: rc];

  url = [NSString stringWithUTF8String: LASSO_PROFILE (tempLogin)->msg_url];
  
  g_object_unref (tempLogin);

  return url;
}

+ (NSString *) metadataInContext: (WOContext *) context
{
  NSString *metadata, *serverURLString, *filename;
  NSBundle *bundle;

  bundle = [NSBundle bundleForClass: self];
  filename = [bundle pathForResource: @"SOGoSAML2Metadata" ofType: @"xml"];
  if (filename)
    {
      serverURLString = [context SAML2ServerURLString];
      metadata = [[NSString stringWithContentsOfFile: filename]
                   stringByReplacingString: @"%{base_url}"
                                withString: serverURLString];
    }
  else
    metadata = nil;

  return metadata;
}

- (id) init
{
  if ((self = [super init]))
    {
      lassoLogin = NULL;
      login = nil;
      identifier = nil;
      assertion = nil;
    }

  return self;
}

- (void) _updateDataFromLogin
{
  // LassoSamlp2Response *response;
  LassoSaml2Assertion *saml2Assertion;
  GList *statementList, *attributeList;
  LassoSaml2AttributeStatement *statement;
  LassoSaml2Attribute *attribute;
  LassoSaml2AttributeValue *value;
  LassoMiscTextNode *textNode;
  LassoSaml2NameID *nameIdentifier;
  gchar *dump;
                  
  saml2Assertion
    = LASSO_SAML2_ASSERTION (lasso_login_get_assertion (lassoLogin));
  if (saml2Assertion)
    {
      /* deduce user login */
      [login release];
      login = nil;

      statementList = saml2Assertion->AttributeStatement;
      while (!login && statementList)
        {
          statement = LASSO_SAML2_ATTRIBUTE_STATEMENT (statementList->data);
          attributeList = statement->Attribute;
          while (!login && attributeList)
            {
              attribute = LASSO_SAML2_ATTRIBUTE (attributeList->data);
              if (strcmp (attribute->Name, "uid") == 0)
                {
                  value = LASSO_SAML2_ATTRIBUTE_VALUE (attribute->AttributeValue->data);
                  textNode = value->any->data;
                  login = [NSString stringWithUTF8String: textNode->content];
                  [login retain];
                }
              else
                attributeList = attributeList->next;
            }
          statementList = statementList->next;
        }

      /* serialize assertion */
      [assertion release];
      dump = lasso_node_export_to_xml (LASSO_NODE (saml2Assertion));
      if (dump)
        {
          assertion = [NSString stringWithUTF8String: dump];
          [assertion retain];
          g_free (dump);
        }
      else
        assertion = nil;
    }

  nameIdentifier
    = LASSO_SAML2_NAME_ID (LASSO_PROFILE (lassoLogin)->nameIdentifier);
  if (nameIdentifier)
    {
      /* deduce session id */
      [identifier release];
      identifier = [NSString stringWithUTF8String: nameIdentifier->content];
      [identifier retain];
    }
}

- (id) _initWithDump: (NSDictionary *) saml2Dump
           inContext: (WOContext *) context
{
  // lasso_error_t rc;
  LassoServer *server;
  LassoProfile *profile;
  const gchar *dump;

  if ((self = [self init]))
    {
      server = LassoServerInContext (context);
      lassoLogin = lasso_login_new (server);
      if (saml2Dump)
        {
          profile = LASSO_PROFILE (lassoLogin);
          ASSIGN (login, [saml2Dump objectForKey: @"login"]);
          ASSIGN (identifier, [saml2Dump objectForKey: @"identifier"]);
          ASSIGN (assertion, [saml2Dump objectForKey: @"assertion"]);
          dump = [[saml2Dump objectForKey: @"identity"] UTF8String];
          if (dump)
            lasso_profile_set_identity_from_dump (profile, dump);
          dump = [[saml2Dump objectForKey: @"session"] UTF8String];
          if (dump)
            lasso_profile_set_session_from_dump (profile, dump);
          lasso_login_accept_sso (lassoLogin);
          // if (rc)
          //   [NSException raiseSAML2Exception: rc];
          [self _updateDataFromLogin];
        }
    }

  return self;
}

- (void) dealloc
{
  if (lassoLogin)
    g_object_unref (lassoLogin);
  [login release];
  [identifier release];
  [assertion release];
  [super dealloc];
}

+ (SOGoSAML2Session *) _SAML2SessionWithDump: (NSDictionary *) saml2Dump
                                   inContext: (WOContext *) context
{
  SOGoSAML2Session *newSession;

  newSession = [[self alloc] _initWithDump: saml2Dump inContext: context];
  [newSession autorelease];

  return newSession;
}

+ (SOGoSAML2Session *) SAML2SessionInContext: (WOContext *) context
{
  return [self _SAML2SessionWithDump: nil inContext: context];
}

+ (SOGoSAML2Session *) SAML2SessionWithIdentifier: (NSString *) identifier
                                        inContext: (WOContext *) context
{
  SOGoSAML2Session *session = nil;
  NSDictionary *saml2Dump;

  if (identifier)
    {
      saml2Dump = [[SOGoCache sharedCache]
                    saml2LoginDumpsForIdentifier: identifier];
      if (saml2Dump)
        session = [self _SAML2SessionWithDump: saml2Dump
                                    inContext: context];
    }

  return session;
}

- (NSString *) login
{
  return login;
}

- (NSString *) identifier
{
  return identifier;
}

- (NSString *) assertion
{
  return assertion;
}

- (void) processAuthnResponse: (NSString *) authnResponse
{
  lasso_error_t rc;
  gchar *responseData, *dump;
  LassoProfile *profile;
  LassoIdentity *identity;
  LassoSession *session;
  NSString *nsDump;
  NSMutableDictionary *saml2Dump;

  responseData = strdup ([authnResponse UTF8String]);

  rc = lasso_login_process_authn_response_msg (lassoLogin, responseData);
  if (rc)
    [NSException raiseSAML2Exception: rc];

  rc = lasso_login_accept_sso (lassoLogin);
  if (rc)
    [NSException raiseSAML2Exception: rc];

  [self _updateDataFromLogin];

  saml2Dump = [NSMutableDictionary dictionary];
  [saml2Dump setObject: login forKey: @"login"];
  [saml2Dump setObject: identifier forKey: @"identifier"];
  [saml2Dump setObject: assertion forKey: @"assertion"];

  profile = LASSO_PROFILE (lassoLogin);

  session = lasso_profile_get_session (profile);
  if (session)
    {
      dump = lasso_session_dump (session);
      nsDump = [NSString stringWithUTF8String: dump];
      [saml2Dump setObject: nsDump forKey: @"session"];
      lasso_session_destroy (session);
    }

  identity = lasso_profile_get_identity (profile);
  if (identity)
    {
      dump = lasso_identity_dump (identity);
      nsDump = [NSString stringWithUTF8String: dump];
      [saml2Dump setObject: nsDump forKey: @"identity"];
      lasso_identity_destroy (identity);
    }

  [[SOGoCache sharedCache] setSaml2LoginDumps: saml2Dump
                                forIdentifier: identifier];
  free (responseData);
}

@end
